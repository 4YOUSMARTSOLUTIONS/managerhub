-- Lembrete diário do absenteísmo: quando quem lançou está ausente, avisa também
-- quem pode agir no lugar dele (LUIZ, 23/11/2026).
--
-- Quem lançou segue recebendo. Se estiver ausente, recebe também o primeiro gestor
-- presente acima dele que tenha o colaborador na própria cadeia, porque só esse
-- consegue efetivar. Sem ninguém presente na cadeia, vai para o DP.
--
-- A montagem dos avisos fica em `absenteismo_lembretes_do_dia`, sem gravar nada,
-- para dar para simular um dia sem disparar notificação nem push.

-- Ausente no dia: afastamento registrado, férias aprovadas em curso (só a efetivação
-- gera o registro em employee_absences) ou vínculo encerrado. Ausência de parte do
-- dia não entra: ela não vira registro em employee_absences.
create or replace function public.absenteismo_esta_ausente(p_tenant uuid, p_user uuid, p_dia date)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select not exists (
           select 1 from public.memberships m
            where m.tenant_id = p_tenant and m.user_id = p_user and m.is_active
              and (m.dismissed_at is null or m.dismissed_at > p_dia))
      or exists (
           select 1 from public.employee_absences e
            where e.tenant_id = p_tenant and e.user_id = p_user
              and p_dia between e.start_date and e.end_date)
      or exists (
           select 1 from public.ferias_solicitacoes f
            where f.tenant_id = p_tenant and f.user_id = p_user and f.status = 'aprovada'
              and p_dia between f.start_date and f.end_date);
$function$;

-- Quem cobre um lançamento de alguém ausente: o primeiro gestor presente acima de
-- quem lançou, com o colaborador na cadeia dele; sem ninguém, o DP presente; sem DP
-- presente, proprietário e administradores.
create or replace function public.absenteismo_quem_cobre(
  p_tenant uuid, p_lancador uuid, p_colaborador uuid, p_dia date
)
returns uuid[]
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_acima_do_colaborador uuid[];
  v_atual uuid := p_lancador;
  v_chefe uuid;
  v_vistos uuid[] := array[p_lancador];
  v_nivel int := 0;
  v_quem uuid[];
begin
  with recursive acima as (
    select m.manager_id as chefe, 1 as nivel
      from public.memberships m
     where m.tenant_id = p_tenant and m.user_id = p_colaborador
    union
    select m.manager_id, a.nivel + 1
      from acima a
      join public.memberships m on m.tenant_id = p_tenant and m.user_id = a.chefe
     where a.nivel < 10 and a.chefe is not null
  )
  select coalesce(array_agg(distinct a.chefe) filter (where a.chefe is not null), '{}'::uuid[])
    into v_acima_do_colaborador
    from acima a;

  loop
    v_chefe := null;
    select m.manager_id into v_chefe
      from public.memberships m
     where m.tenant_id = p_tenant and m.user_id = v_atual;
    v_nivel := v_nivel + 1;
    exit when v_chefe is null or v_nivel > 10 or v_chefe = any(v_vistos);

    if v_chefe <> p_colaborador
       and v_chefe = any(v_acima_do_colaborador)
       and exists (
         select 1 from public.memberships m
          where m.tenant_id = p_tenant and m.user_id = v_chefe
            and m.role in ('owner', 'admin', 'manager', 'team_lead'))
       and not public.absenteismo_esta_ausente(p_tenant, v_chefe, p_dia) then
      return array[v_chefe];
    end if;

    v_vistos := v_vistos || v_chefe;
    v_atual := v_chefe;
  end loop;

  select array_agg(m.user_id) into v_quem
    from public.memberships m
   where m.tenant_id = p_tenant and m.is_hr
     and m.user_id not in (p_lancador, p_colaborador)
     and not public.absenteismo_esta_ausente(p_tenant, m.user_id, p_dia);
  if v_quem is not null then
    return v_quem;
  end if;

  select array_agg(m.user_id) into v_quem
    from public.memberships m
   where m.tenant_id = p_tenant and m.role in ('owner', 'admin')
     and m.user_id not in (p_lancador, p_colaborador)
     and not public.absenteismo_esta_ausente(p_tenant, m.user_id, p_dia);
  return coalesce(v_quem, '{}'::uuid[]);
end;
$function$;

-- Os avisos do dia, um por pessoa. Só monta o texto; quem grava é o lembrete.
create or replace function public.absenteismo_lembretes_do_dia(p_hoje date)
returns table (o_tenant_id uuid, o_user_id uuid, o_titulo text, o_corpo text)
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  r record;
  v_titulo text;
  v_corpo text;
  v_quem text;
  v_cobertura text;
begin
  for r in
    with pend as (
      select l.tenant_id, l.created_by, l.user_id, l.status, l.partial_day, l.occurred_on, l.snap_full_name,
             public.absenteismo_esta_ausente(l.tenant_id, l.created_by, p_hoje) as lancador_ausente
        from public.absenteismo_lancamentos l
       where (l.status = 'aberto'
              and coalesce(l.ausente_ate, l.occurred_on) < p_hoje)
          or (l.status = 'reprovado'
              and coalesce((l.decided_at at time zone 'America/Sao_Paulo')::date, l.occurred_on) < p_hoje)
    ),
    proprios as (
      select l.tenant_id, l.created_by,
             count(*) filter (where l.status = 'aberto') as qtd_aberto,
             count(*) filter (where l.status = 'reprovado') as qtd_reprov,
             -- em aberto
             min(coalesce(l.snap_full_name, 'Colaborador')) filter (where l.status = 'aberto') as nome_aberto,
             min(l.occurred_on) filter (where l.status = 'aberto') as desde,
             bool_and(l.partial_day) filter (where l.status = 'aberto') as so_parcial,
             string_agg(coalesce(l.snap_full_name, 'Colaborador') || ' (desde ' || to_char(l.occurred_on, 'DD/MM') || ')',
                        ', ' order by l.occurred_on, l.snap_full_name) filter (where l.status = 'aberto') as quem_aberto,
             -- reprovados
             min(coalesce(l.snap_full_name, 'Colaborador')) filter (where l.status = 'reprovado') as nome_reprov,
             min(l.occurred_on) filter (where l.status = 'reprovado') as dia_reprov,
             string_agg(coalesce(l.snap_full_name, 'Colaborador') || ' (' || to_char(l.occurred_on, 'DD/MM') || ')',
                        ', ' order by l.occurred_on, l.snap_full_name) filter (where l.status = 'reprovado') as quem_reprov
        from pend l
       -- desligado ou inativo não acessa mais: o aviso vai só para quem cobre
       where exists (
         select 1 from public.memberships m
          where m.tenant_id = l.tenant_id and m.user_id = l.created_by and m.is_active
            and (m.dismissed_at is null or m.dismissed_at > p_hoje))
       group by l.tenant_id, l.created_by
    ),
    por_ausente as (
      select l.tenant_id, d.dest, l.created_by, count(*)::int as qtd,
             bool_or(l.status = 'aberto' and not l.partial_day) as pode_continuar
        from pend l
        cross join lateral unnest(
          public.absenteismo_quem_cobre(l.tenant_id, l.created_by, l.user_id, p_hoje)
        ) as d(dest)
       where l.lancador_ausente
       group by l.tenant_id, d.dest, l.created_by
    ),
    cobre as (
      select c.tenant_id, c.dest,
             sum(c.qtd)::int as qtd_cob,
             bool_or(c.pode_continuar) as pode_continuar,
             count(*)::int as n_ausentes,
             array_agg(x.nome order by x.nome) as nomes
        from por_ausente c
        left join public.profiles pr on pr.id = c.created_by
        cross join lateral (
          select regexp_split_to_array(btrim(coalesce(pr.full_name, 'Gestor')), '\s+') as partes
        ) as n
        cross join lateral (
          select initcap(n.partes[1]
            || case when cardinality(n.partes) > 1 then ' ' || n.partes[cardinality(n.partes)] else '' end) as nome
        ) as x
       group by c.tenant_id, c.dest
    )
    select coalesce(p.tenant_id, c.tenant_id) as destino_tenant,
           coalesce(p.created_by, c.dest) as destino_user,
           p.created_by is not null as tem_proprios,
           coalesce(p.qtd_aberto, 0) as qtd_aberto, coalesce(p.qtd_reprov, 0) as qtd_reprov,
           p.nome_aberto, p.desde, p.so_parcial, p.quem_aberto, p.nome_reprov, p.dia_reprov, p.quem_reprov,
           coalesce(c.qtd_cob, 0) as qtd_cob, c.pode_continuar, coalesce(c.n_ausentes, 0) as n_ausentes, c.nomes
      from proprios p
      full join cobre c on c.tenant_id = p.tenant_id and c.dest = p.created_by
  loop
    v_titulo := null;
    v_corpo := null;

    if r.tem_proprios then
      if r.qtd_reprov = 0 then
        -- só em aberto: o texto de sempre
        v_titulo := case when r.qtd_aberto = 1 then 'Ausência em aberto' else r.qtd_aberto || ' ausências em aberto' end;
        v_corpo := case when r.qtd_aberto = 1 then
            r.nome_aberto || ' segue em aberto desde ' || to_char(r.desde, 'DD/MM') || '. '
              || case when r.so_parcial then 'Efetive quando tiver o horário e o motivo.'
                      else 'Se não comparecer hoje, registre em "Continua ausente". Quando tiver o motivo, use Efetivar.' end
          else
            'Seguem em aberto: ' || r.quem_aberto || '. Registre quem continua ausente e efetive quem já tem o motivo.'
          end;
      elsif r.qtd_aberto = 0 then
        -- só reprovados
        v_titulo := case when r.qtd_reprov = 1 then 'Ausência reprovada para corrigir'
                         else r.qtd_reprov || ' ausências reprovadas para corrigir' end;
        v_corpo := case when r.qtd_reprov = 1 then
            'A ausência de ' || r.nome_reprov || ' (' || to_char(r.dia_reprov, 'DD/MM') || ') foi reprovada pelo DP e segue sem correção. '
              || 'Corrija pelo Efetivar e envie de novo, ou cancele o lançamento se ela não procede.'
          else
            'Reprovadas pelo DP e ainda sem correção: ' || r.quem_reprov || '. '
              || 'Corrija pelo Efetivar e envie de novo, ou cancele o lançamento que não procede.'
          end;
      else
        -- os dois
        v_titulo := (r.qtd_aberto + r.qtd_reprov) || ' ausências esperando você';
        v_corpo := 'Em aberto: ' || r.quem_aberto || '. Reprovadas pelo DP: ' || r.quem_reprov || '. '
          || 'Registre quem continua ausente, efetive quem já tem o motivo e corrija as reprovadas pelo Efetivar.';
      end if;
    end if;

    if r.qtd_cob > 0 then
      -- o motivo da ausência não aparece: atestado e licença são dado sensível
      v_quem := case
        when r.n_ausentes = 1 then r.nomes[1]
        when r.n_ausentes = 2 then r.nomes[1] || ' e ' || r.nomes[2]
        when r.n_ausentes = 3 then r.nomes[1] || ', ' || r.nomes[2] || ' e ' || r.nomes[3]
        else r.nomes[1] || ', ' || r.nomes[2] || ' e mais ' || (r.n_ausentes - 2) || ' pessoas'
      end;
      v_cobertura := v_quem
        || case when r.n_ausentes = 1 then ' está ausente e tem ' else ' estão ausentes e têm ' end
        || r.qtd_cob || case when r.qtd_cob = 1 then ' absenteísmo pendente. ' else ' absenteísmos pendentes. ' end
        || 'Você pode ' || case when r.qtd_cob = 1 then 'efetivá-lo' else 'efetivá-los' end
        || case when r.pode_continuar then ' ou registrar que o colaborador continua ausente' else '' end
        || ' na tela de Absenteísmos.';

      if r.tem_proprios then
        v_titulo := (r.qtd_aberto + r.qtd_reprov + r.qtd_cob) || ' ausências esperando você';
        v_corpo := v_corpo || ' Além disso: ' || v_cobertura;
      else
        v_titulo := case when r.qtd_cob = 1 then 'Absenteísmo pendente de gestor ausente'
                         when r.n_ausentes = 1 then r.qtd_cob || ' absenteísmos pendentes de gestor ausente'
                         else r.qtd_cob || ' absenteísmos pendentes de gestores ausentes' end;
        v_corpo := v_cobertura;
      end if;
    end if;

    o_tenant_id := r.destino_tenant;
    o_user_id := r.destino_user;
    o_titulo := v_titulo;
    o_corpo := v_corpo;
    return next;
  end loop;
end;
$function$;

create or replace function public.absenteismo_lembrar_em_aberto()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
  v_n int := 0;
begin
  for r in select * from public.absenteismo_lembretes_do_dia(v_hoje) loop
    perform public.notify_users_sistema(
      r.o_tenant_id, array[r.o_user_id], 'absenteismo_em_aberto', r.o_titulo, r.o_corpo);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

-- Tudo interno: só o cron chama, e os auxiliares rodam dentro do lembrete.
revoke execute on function public.absenteismo_esta_ausente(uuid, uuid, date) from public, anon, authenticated;
revoke execute on function public.absenteismo_quem_cobre(uuid, uuid, uuid, date) from public, anon, authenticated;
revoke execute on function public.absenteismo_lembretes_do_dia(date) from public, anon, authenticated;
revoke execute on function public.absenteismo_lembrar_em_aberto() from public, anon, authenticated;

notify pgrst, 'reload schema';
