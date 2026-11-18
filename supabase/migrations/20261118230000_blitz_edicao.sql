-- Blitz: correção pelo avaliador, registrada e à vista (LUIZ, 18/11/2026).
--
-- Pode acontecer de alguém lançar errado (a pessoa, uma resposta, a placa).
-- Corrige quem tem a marca de avaliador da blitz, a equipe de segurança e a
-- administração; Gestor e Gerencial não (a não ser que também tenham a marca).
-- Só blitz deste mês e do anterior, para não mexer em resultado fechado há
-- tempo, e sempre com o motivo.
--
-- Toda correção fica em `seg_blitz_edicoes` (quem, quando, motivo e a blitz
-- inteira antes e depois, respostas inclusive: o log genérico pega a linha da
-- blitz, mas não as respostas), e a blitz ganha `editada_em`/`editada_por`.
--
-- Tratativas:
--  - pendente que a correção desfaz (virou conforme, virou educativa ou mudou
--    de pessoa) é retirada, e o gestor é avisado; na recorrência, as outras
--    blitz voltam a contar e a conta é refeita;
--  - a blitz que passou a não conforme abre pela regra da empresa;
--  - tratativa já registrada fica como histórico. Por isso trocar a pessoa de
--    uma blitz que já tem tratativa registrada é recusado.

alter table public.seg_blitz_avaliacoes
  add column if not exists editada_em timestamptz,
  add column if not exists editada_por uuid references public.profiles(id) on delete set null;

create table if not exists public.seg_blitz_edicoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  avaliacao_id uuid not null references public.seg_blitz_avaliacoes(id) on delete cascade,
  editado_por uuid references public.profiles(id) on delete set null,
  editado_em timestamptz not null default now(),
  motivo text not null,
  antes jsonb not null,
  depois jsonb not null
);
create index if not exists seg_blitz_edicoes_avaliacao on public.seg_blitz_edicoes (avaliacao_id, editado_em desc);

alter table public.seg_blitz_edicoes enable row level security;
revoke all on table public.seg_blitz_edicoes from public, anon, authenticated;
grant select on table public.seg_blitz_edicoes to authenticated;
-- quem vê a blitz vê as correções dela (a RLS das avaliações vale na subconsulta)
create policy seg_blitz_edicoes_select on public.seg_blitz_edicoes
  for select to authenticated
  using (avaliacao_id in (select a.id from public.seg_blitz_avaliacoes a));

-- A blitz inteira, com os nomes, para o antes e depois da correção.
create or replace function public.seg_blitz_foto(p_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'user_id', a.user_id,
    'colaborador', a.snap_full_name,
    'occurred_on', a.occurred_on,
    'meio_id', a.meio_id,
    'meio', m.name,
    'placa', a.placa,
    'veiculo_tipo', a.veiculo_tipo,
    'propriedade', a.propriedade,
    'cor', a.cor,
    'liberado', a.liberado,
    'motivo_bloqueio_id', a.motivo_bloqueio_id,
    'motivo', mo.name,
    'observacao', a.observacao,
    'conforme', a.conforme,
    'educativa', a.educativa,
    'respostas', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'pergunta_id', r.pergunta_id, 'pergunta', r.snap_pergunta, 'resposta', r.resposta)
               order by r.snap_pergunta), '[]'::jsonb)
        from public.seg_blitz_respostas r
       where r.avaliacao_id = a.id
    )
  )
    from public.seg_blitz_avaliacoes a
    left join public.seg_blitz_meios m on m.id = a.meio_id
    left join public.seg_blitz_motivos mo on mo.id = a.motivo_bloqueio_id
   where a.id = p_id;
$function$;

create or replace function public.seg_editar_blitz(p_id uuid, p_data jsonb, p_motivo text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant    uuid := public.my_active_tenant();
  v_old       record;
  v_v         jsonb;
  v_user      uuid;
  v_ocorrido  date := nullif(p_data->>'occurred_on', '')::date;
  v_motivo    text := btrim(coalesce(p_motivo, ''));
  v_hoje      date := (now() at time zone 'America/Sao_Paulo')::date;
  v_reg_dia   date;
  v_antes     jsonb;
  v_depois    jsonb;
  v_veiculo   uuid;
  v_educativa boolean;
  v_conforme  boolean;
  v_trocou    boolean;
  v_al        record;
  v_ids       uuid[];
  v_ultima    uuid;
begin
  if v_tenant is null then
    raise exception 'Você não tem acesso a esta empresa.';
  end if;
  if not (public.is_avaliador_blitz(v_tenant) or public.pode_tratar_seguranca(v_tenant)) then
    raise exception 'Só o avaliador da blitz e a equipe de segurança corrigem uma blitz.' using errcode = '42501';
  end if;

  select a.* into v_old
    from public.seg_blitz_avaliacoes a
   where a.id = p_id and a.tenant_id = v_tenant
   for update;
  if v_old.id is null then
    raise exception 'Blitz não encontrada.';
  end if;
  if length(v_motivo) < 5 then
    raise exception 'Escreva o motivo da correção.';
  end if;
  -- deste mês e do anterior: resultado fechado há mais tempo não muda
  if v_old.occurred_on < (date_trunc('month', v_hoje) - interval '1 month')::date then
    raise exception 'Só dá para corrigir blitz deste mês e do anterior.';
  end if;

  -- a data segue a regra do lançamento: o mês do registro, até o dia dele
  v_reg_dia := (v_old.registrada_em at time zone 'America/Sao_Paulo')::date;
  if v_ocorrido is null then
    raise exception 'Informe a data da blitz.';
  end if;
  if v_ocorrido > v_reg_dia or v_ocorrido < date_trunc('month', v_reg_dia)::date then
    raise exception 'A data da blitz precisa ser do mês do registro: de % até %.',
      to_char(date_trunc('month', v_reg_dia), 'DD/MM/YYYY'), to_char(v_reg_dia, 'DD/MM/YYYY');
  end if;

  v_v := public.seg_blitz_validar(v_tenant, p_data, v_old.user_id, v_old.meio_id);
  v_user := (v_v->>'user_id')::uuid;
  v_trocou := v_user <> v_old.user_id;
  v_conforme := (v_v->>'conforme')::boolean;

  if v_trocou and exists (
    select 1 from public.seg_blitz_alerta_avaliacoes l
      join public.seg_blitz_alertas al on al.id = l.alerta_id
     where l.avaliacao_id = p_id and al.registrada_em is not null
  ) then
    raise exception 'A tratativa desta blitz já foi registrada pelo gestor, e trocar o colaborador apagaria esse histórico. Para corrigir a pessoa, o proprietário exclui a blitz e ela é lançada de novo.';
  end if;

  -- uma blitz por vez por pessoa, como no lançamento (a mesma chave), e na
  -- troca as duas pessoas, sempre na mesma ordem
  perform pg_advisory_xact_lock(hashtextextended('seg_blitz:' || v_tenant::text || ':' || least(v_user, v_old.user_id)::text, 0));
  if v_trocou then
    perform pg_advisory_xact_lock(hashtextextended('seg_blitz:' || v_tenant::text || ':' || greatest(v_user, v_old.user_id)::text, 0));
  end if;

  v_antes := public.seg_blitz_foto(p_id);

  -- o veículo: o cadastro segue a última blitz da pessoa; corrigir uma blitz
  -- mais antiga só aponta para o veículo da placa, sem mexer no cadastro
  if coalesce((v_v->>'tem_veiculo')::boolean, false) then
    if not exists (
      select 1 from public.seg_blitz_avaliacoes a
       where a.tenant_id = v_tenant and a.user_id = v_user and a.id <> p_id
         and (a.occurred_on, a.registrada_em) > (v_ocorrido, v_old.registrada_em)
    ) then
      v_veiculo := public.seg_blitz_gravar_veiculo(v_tenant, v_v);
    else
      select x.id into v_veiculo from public.seg_veiculos x
       where x.tenant_id = v_tenant and x.placa = v_v->>'placa';
    end if;
  end if;

  -- a educativa é da primeira blitz da pessoa: só se refaz quando a pessoa muda
  v_educativa := case when v_trocou
    then public.seg_blitz_eh_primeira_educativa(v_tenant, v_user, p_id)
    else v_old.educativa end;

  update public.seg_blitz_avaliacoes set
    user_id = v_user,
    occurred_on = v_ocorrido,
    meio_id = (v_v->>'meio_id')::uuid,
    veiculo_id = v_veiculo,
    placa = v_v->>'placa',
    veiculo_tipo = v_v->>'veiculo_tipo',
    propriedade = (v_v->>'propriedade')::public.seg_veiculo_propriedade,
    cor = v_v->>'cor',
    liberado = (v_v->>'liberado')::boolean,
    motivo_bloqueio_id = (v_v->>'motivo_bloqueio_id')::uuid,
    observacao = v_v->>'observacao',
    conforme = v_conforme,
    educativa = v_educativa,
    editada_em = now(),
    editada_por = (select auth.uid())
  where id = p_id;

  -- outra pessoa: o carimbo da época é refeito com o cadastro dela, como no lançamento
  if v_trocou then
    update public.seg_blitz_avaliacoes a set
      snap_full_name = p.full_name,
      snap_department_id = m.department_id,
      snap_department_name = d.name,
      snap_position_name = pos.name,
      snap_manager_id = m.manager_id,
      snap_manager_name = mg.full_name,
      snap_unit_id = null,
      snap_unit_name = null,
      unit_id = null
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    left join public.departments d on d.id = m.department_id
    left join public.positions pos on pos.id = m.position_id
    left join public.profiles mg on mg.id = m.manager_id
    where a.id = p_id and m.user_id = v_user and m.tenant_id = v_tenant;

    update public.seg_blitz_avaliacoes a set
      snap_unit_id = u.id, snap_unit_name = u.name, unit_id = u.id
    from (
      select un.id, un.name
        from public.memberships m
        join public.membership_units mu on mu.membership_id = m.id
        join public.units un on un.id = mu.unit_id
       where m.user_id = v_user and m.tenant_id = v_tenant
       order by un.name
       limit 1
    ) u
    where a.id = p_id;
  end if;

  -- as respostas: a pergunta que continua mantém o texto da época; a que saiu
  -- do formulário (o meio mudou, por exemplo) sai da blitz
  delete from public.seg_blitz_respostas r
   where r.avaliacao_id = p_id
     and (r.pergunta_id is null or not exists (
       select 1 from jsonb_array_elements(coalesce(p_data->'respostas', '[]'::jsonb)) as x(v)
        where nullif(x.v->>'pergunta_id', '')::uuid = r.pergunta_id
     ));
  update public.seg_blitz_respostas r
     set resposta = (x.v->>'resposta')::public.seg_blitz_resposta
    from jsonb_array_elements(coalesce(p_data->'respostas', '[]'::jsonb)) as x(v)
   where r.avaliacao_id = p_id
     and r.pergunta_id = nullif(x.v->>'pergunta_id', '')::uuid
     and r.resposta is distinct from (x.v->>'resposta')::public.seg_blitz_resposta;
  perform public.seg_blitz_gravar_respostas(p_id, v_tenant, p_data->'respostas');

  v_depois := public.seg_blitz_foto(p_id);
  if v_depois = v_antes then
    raise exception 'Nada mudou na blitz: altere o que estava errado antes de salvar.';
  end if;

  -- as tratativas pendentes que a correção desfaz
  for v_al in
    select al.* from public.seg_blitz_alertas al
     where al.registrada_em is null
       and al.id in (select l.alerta_id from public.seg_blitz_alerta_avaliacoes l where l.avaliacao_id = p_id)
       and (v_conforme or v_educativa or v_trocou)
  loop
    select array_agg(l.avaliacao_id) into v_ids
      from public.seg_blitz_alerta_avaliacoes l
     where l.alerta_id = v_al.id and l.avaliacao_id <> p_id;
    delete from public.seg_blitz_alertas where id = v_al.id;

    perform public.notify_users(
      v_tenant, array[v_al.gestor_id], 'seg_blitz_alerta',
      'Tratativa de blitz retirada',
      'A blitz de ' || coalesce(v_old.snap_full_name, 'um colaborador') || ' em ' ||
      to_char(v_old.occurred_on, 'DD/MM/YYYY') || ' foi corrigida e não precisa mais desta tratativa.',
      null
    );

    -- recorrência: as outras blitz voltam a contar, e a conta é refeita
    if v_ids is not null then
      select a.id into v_ultima
        from public.seg_blitz_avaliacoes a
       where a.id = any(v_ids)
       order by a.occurred_on desc, a.registrada_em desc
       limit 1;
      perform public.seg_blitz_acionar(v_ultima);
    end if;
  end loop;

  -- não conforme e sem tratativa: abre pela regra da empresa (a educativa não)
  perform public.seg_blitz_acionar(p_id);

  insert into public.seg_blitz_edicoes (tenant_id, avaliacao_id, editado_por, motivo, antes, depois)
  values (v_tenant, p_id, (select auth.uid()), v_motivo, v_antes, v_depois);

  return p_id;
end;
$function$;

-- As listas de tratativa dizem quando a blitz foi corrigida depois.
create or replace function public.seg_blitz_do_alerta(p_alerta uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'occurred_on', a.occurred_on,
           'liberado', a.liberado,
           'conforme', a.conforme,
           'editada', a.editada_em is not null,
           'meio', m.name,
           'motivo', mo.name,
           'nao', (select coalesce(jsonb_agg(r.snap_pergunta order by r.snap_pergunta), '[]'::jsonb)
                     from public.seg_blitz_respostas r
                    where r.avaliacao_id = a.id and r.resposta = 'nao'))
           order by a.occurred_on, a.registrada_em), '[]'::jsonb)
    from public.seg_blitz_alerta_avaliacoes l
    join public.seg_blitz_avaliacoes a on a.id = l.avaliacao_id
    left join public.seg_blitz_meios m on m.id = a.meio_id
    left join public.seg_blitz_motivos mo on mo.id = a.motivo_bloqueio_id
   where l.alerta_id = p_alerta;
$function$;

do $$
declare
  d text;
  de text := E'             ''tipo'', al.tipo,\n';
begin
  d := pg_get_functiondef('public.seg_blitz_alertas_do_periodo(date,date,uuid[],boolean)'::regprocedure);
  if (length(d) - length(replace(d, de, ''))) <> length(de) then
    raise exception 'seg_blitz_alertas_do_periodo: trecho não encontrado exatamente uma vez';
  end if;
  execute replace(d, de, de || E'             ''editada'', a.editada_em is not null,\n');

  de := E'      ''tipo'', al.tipo,\n';
  d := pg_get_functiondef('public.seg_blitz_meus_alertas()'::regprocedure);
  if (length(d) - length(replace(d, de, ''))) <> length(de) then
    raise exception 'seg_blitz_meus_alertas: trecho não encontrado exatamente uma vez';
  end if;
  execute replace(d, de, de || E'      ''editada'', a.editada_em is not null,\n');
end $$;

revoke execute on function public.seg_blitz_foto(uuid) from public, anon, authenticated;
revoke execute on function public.seg_blitz_do_alerta(uuid) from public, anon, authenticated;
revoke execute on function public.seg_editar_blitz(uuid, jsonb, text) from public, anon;
grant execute on function public.seg_editar_blitz(uuid, jsonb, text) to authenticated;
revoke execute on function public.seg_blitz_alertas_do_periodo(date, date, uuid[], boolean) from public, anon;
revoke execute on function public.seg_blitz_meus_alertas() from public, anon;

notify pgrst, 'reload schema';
