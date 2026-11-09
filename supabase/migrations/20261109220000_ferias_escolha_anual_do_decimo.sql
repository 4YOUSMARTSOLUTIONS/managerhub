-- ---------------------------------------------------------------------------
-- Férias: o colaborador operacional escolhe, por ano, se quer o adiantamento
-- da 1ª parcela do 13º.
--
-- Pedido do LUIZ (09/11/2026). Quem está num nível de `ferias_niveis_bloqueados`
-- não solicita as próprias férias (o gestor lança), mas o adiantamento do 13º
-- é escolha DELE: a lei diz que o empregado pede, em janeiro (Lei 4.749/65).
-- Decisão: uma escolha por ANO, feita em Minhas férias até 31/01 do ano das
-- férias; o gestor deixa de decidir o 13º desses colaboradores.
--
-- Como a escolha vira o 13º das férias:
--   - quer adiantar em AAAA: o PRIMEIRO período de AAAA lançado (o de início
--     mais cedo no lançamento) leva o 13º, se nenhum outro de AAAA já leva;
--   - não quer, ou não escolheu: nenhum período de AAAA leva;
--   - vale para as três portas do gestor/DP: lançar (e o lote, que passa por
--     ela), reagendar e corrigir/reenviar. O valor que a tela manda é ignorado.
--   - `decimo_fora_prazo` da linha passa a vir da escolha (feita no prazo, não
--     é fora do prazo, mesmo que o gestor lance em agosto).
--
-- Mudar a escolha (só até 31/01, quando a empresa bloqueia fora do prazo)
-- refaz o 13º das férias de AAAA ainda NÃO efetivadas. Desistir depois que o
-- DP efetivou umas férias de AAAA com o 13º é recusado: fala com o DP.
-- ---------------------------------------------------------------------------

-- 1) a escolha
create table public.ferias_decimo_escolhas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  ano int not null check (ano between 2000 and 2100),
  quer boolean not null,
  fora_prazo boolean not null default false,
  escolhido_em timestamptz not null default now(),
  escolhido_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id, ano)
);

alter table public.ferias_decimo_escolhas enable row level security;
-- sem policy e sem grant: leitura e escrita só pelas RPCs abaixo
revoke all on table public.ferias_decimo_escolhas from public, anon, authenticated;

create trigger trg_ferias_decimo_escolhas_updated
  before update on public.ferias_decimo_escolhas
  for each row execute function public.set_updated_at();
create trigger audit_ferias_decimo_escolhas
  after insert or update or delete on public.ferias_decimo_escolhas
  for each row execute function public.audit_trigger();

-- 2) ajudantes internos
create or replace function public.ferias_nivel_bloqueado(p_tenant uuid, p_user uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.ferias_niveis_bloqueados b
      join public.memberships m on m.tenant_id = b.tenant_id
       and m.hierarchy_level_id = b.hierarchy_level_id
     where b.tenant_id = p_tenant and m.user_id = p_user);
$function$;

revoke execute on function public.ferias_nivel_bloqueado(uuid, uuid) from public, anon, authenticated;

-- o 13º de cada período, pela escolha anual (devolve na ordem recebida)
create or replace function public.ferias_decimo_pela_escolha(
  p_tenant uuid, p_user uuid, p_periodos jsonb, p_excluir uuid default null)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  r record;
  v_ano int;
  v_dec boolean;
  v_marcados int[] := '{}';
  v_tmp jsonb := '[]'::jsonb;
begin
  for r in
    select t.e, t.o from jsonb_array_elements(coalesce(p_periodos, '[]'::jsonb)) with ordinality as t(e, o)
     order by nullif(t.e->>'inicio', '')::date nulls last, t.o
  loop
    v_ano := extract(year from nullif(r.e->>'inicio', '')::date)::int;
    v_dec := v_ano is not null
      and not (v_ano = any(v_marcados))
      and exists (select 1 from public.ferias_decimo_escolhas c
                   where c.tenant_id = p_tenant and c.user_id = p_user and c.ano = v_ano and c.quer)
      and not exists (select 1 from public.ferias_solicitacoes f
                       where f.tenant_id = p_tenant and f.user_id = p_user
                         and f.status in ('solicitada', 'aprovada', 'efetivada')
                         and (p_excluir is null or f.id <> p_excluir)
                         and f.adiantar_decimo_terceiro
                         and extract(year from f.start_date) = v_ano);
    if v_dec then
      v_marcados := v_marcados || v_ano;
    end if;
    v_tmp := v_tmp || jsonb_build_object('o', r.o, 'e', r.e || jsonb_build_object('decimo', v_dec));
  end loop;

  return (select coalesce(jsonb_agg(x->'e' order by (x->>'o')::int), '[]'::jsonb)
            from jsonb_array_elements(v_tmp) x);
end;
$function$;

revoke execute on function public.ferias_decimo_pela_escolha(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

-- o "fora do prazo" do 13º vem da escolha, não do dia em que o gestor lançou
create or replace function public.ferias_decimo_prazo_da_escolha(p_tenant uuid, p_user uuid, p_validado jsonb)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(
           t.e || jsonb_build_object('decimo_fora_prazo',
             coalesce((t.e->>'decimo')::boolean, false)
             and coalesce((select c.fora_prazo from public.ferias_decimo_escolhas c
                            where c.tenant_id = p_tenant and c.user_id = p_user
                              and c.ano = extract(year from (t.e->>'inicio')::date)::int), false))
           order by t.o), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_validado, '[]'::jsonb)) with ordinality as t(e, o);
$function$;

revoke execute on function public.ferias_decimo_prazo_da_escolha(uuid, uuid, jsonb) from public, anon, authenticated;

-- refaz o 13º das férias de um ano ainda não efetivadas, depois de mudar a escolha
create or replace function public.ferias_decimo_sincronizar(p_tenant uuid, p_user uuid, p_ano int)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_quer boolean;
  v_fora boolean;
begin
  select c.quer, c.fora_prazo into v_quer, v_fora
    from public.ferias_decimo_escolhas c
   where c.tenant_id = p_tenant and c.user_id = p_user and c.ano = p_ano;

  perform set_config('ferias.decimo_escolha', '1', true);

  update public.ferias_solicitacoes f
     set adiantar_decimo_terceiro = false, decimo_fora_prazo = false
   where f.tenant_id = p_tenant and f.user_id = p_user
     and f.status in ('solicitada', 'aprovada')
     and extract(year from f.start_date) = p_ano
     and f.adiantar_decimo_terceiro;

  if coalesce(v_quer, false) and not exists (
       select 1 from public.ferias_solicitacoes f
        where f.tenant_id = p_tenant and f.user_id = p_user and f.status = 'efetivada'
          and f.adiantar_decimo_terceiro and extract(year from f.start_date) = p_ano) then
    update public.ferias_solicitacoes f
       set adiantar_decimo_terceiro = true, decimo_fora_prazo = coalesce(v_fora, false)
     where f.id = (select g.id from public.ferias_solicitacoes g
                    where g.tenant_id = p_tenant and g.user_id = p_user
                      and g.status in ('solicitada', 'aprovada')
                      and extract(year from g.start_date) = p_ano
                    order by g.start_date limit 1);
  end if;

  perform set_config('ferias.decimo_escolha', '', true);
end;
$function$;

revoke execute on function public.ferias_decimo_sincronizar(uuid, uuid, int) from public, anon, authenticated;

-- 3) a guarda das previsões deixa a escolha mexer só no 13º de quem ainda não foi efetivado
do $do$
declare
  v_def text;
  v_ancora text := $q$begin
  -- A importação da folha reatribui o aquisitivo$q$;
begin
  v_def := pg_get_functiondef('public.guard_ferias_solicitacao()'::regprocedure);
  if strpos(v_def, v_ancora) = 0 then
    raise exception 'guarda: âncora não encontrada';
  end if;
  v_def := replace(v_def, v_ancora, $q$begin
  -- A escolha anual do 13º (20261109220000) refaz o adiantamento das férias
  -- ainda não efetivadas; só o 13º e o seu "fora do prazo" mudam.
  if coalesce(current_setting('ferias.decimo_escolha', true), '') = '1'
     and new.status = old.status and old.status in ('solicitada', 'aprovada')
     and new.user_id = old.user_id
     and new.start_date = old.start_date and new.end_date = old.end_date
     and new.abono_dias = old.abono_dias
     and new.aquisitivo_inicio is not distinct from old.aquisitivo_inicio
     and new.aquisitivo_fim is not distinct from old.aquisitivo_fim then
    return new;
  end if;

  -- A importação da folha reatribui o aquisitivo$q$);
  execute v_def;
end
$do$;

revoke execute on function public.guard_ferias_solicitacao() from public, anon, authenticated;

-- 4) as três portas do gestor/DP seguem a escolha de quem é operacional
do $do$
declare
  v_def text;
  a1 text := $q$  v_val := public.ferias_validar_periodos(p_tenant, p_user, p_periodos, p_hoje, null, v_just is not null);$q$;
  a2 text := $q$  v_val := public.ferias_aplicar_prazos_legais(p_tenant, v_val, case when v_eh_dp then 'dp' else 'gestor' end);$q$;
begin
  v_def := pg_get_functiondef('public.ferias_lancar(uuid, uuid, jsonb, date, text)'::regprocedure);
  if strpos(v_def, a1) = 0 or strpos(v_def, a2) = 0 then
    raise exception 'ferias_lancar: âncora não encontrada';
  end if;
  v_def := replace(v_def, a1, $q$  -- operacional: o 13º segue a escolha anual do colaborador, não a tela
  if public.ferias_nivel_bloqueado(p_tenant, p_user) then
    p_periodos := public.ferias_decimo_pela_escolha(p_tenant, p_user, p_periodos, null);
  end if;

$q$ || a1);
  v_def := replace(v_def, a2, a2 || $q$
  if public.ferias_nivel_bloqueado(p_tenant, p_user) then
    v_val := public.ferias_decimo_prazo_da_escolha(p_tenant, p_user, v_val);
  end if;$q$);
  execute v_def;
end
$do$;

do $do$
declare
  v_def text;
  a1 text := $q$  perform public.ferias_checar_antecedencia(v_o.tenant_id, p_inicio,$q$;
  a2 text := $q$  v_status := case when v_dono and not (v_gestor or v_dp) then 'solicitada' else 'aprovada' end;$q$;
begin
  v_def := pg_get_functiondef('public.ferias_reagendar(uuid, date, date, integer, boolean, date)'::regprocedure);
  if strpos(v_def, a1) = 0 or strpos(v_def, a2) = 0 then
    raise exception 'ferias_reagendar: âncora não encontrada';
  end if;
  v_def := replace(v_def, a1, $q$  -- operacional: o 13º segue a escolha anual do colaborador, não a tela
  if public.ferias_nivel_bloqueado(v_o.tenant_id, v_o.user_id) then
    p_decimo := coalesce((public.ferias_decimo_pela_escolha(v_o.tenant_id, v_o.user_id,
      jsonb_build_array(jsonb_build_object('inicio', p_inicio)), p_id)->0->>'decimo')::boolean, false);
  end if;

$q$ || a1);
  v_def := replace(v_def, a2, $q$  if public.ferias_nivel_bloqueado(v_o.tenant_id, v_o.user_id) then
    v_val := public.ferias_decimo_prazo_da_escolha(v_o.tenant_id, v_o.user_id, v_val);
  end if;

$q$ || a2);
  execute v_def;
end
$do$;

do $do$
declare
  v_def text;
  a1 text := $q$  perform public.ferias_checar_antecedencia(v_l.tenant_id, p_inicio,$q$;
  a2 text := $q$  update public.ferias_solicitacoes
     set status = 'solicitada',$q$;
begin
  v_def := pg_get_functiondef('public.ferias_reenviar(uuid, date, date, integer, boolean, date)'::regprocedure);
  if strpos(v_def, a1) = 0 or strpos(v_def, a2) = 0 then
    raise exception 'ferias_reenviar: âncora não encontrada';
  end if;
  v_def := replace(v_def, a1, $q$  -- operacional: o 13º segue a escolha anual do colaborador, não a tela
  if public.ferias_nivel_bloqueado(v_l.tenant_id, v_l.user_id) then
    p_decimo := coalesce((public.ferias_decimo_pela_escolha(v_l.tenant_id, v_l.user_id,
      jsonb_build_array(jsonb_build_object('inicio', p_inicio)), p_id)->0->>'decimo')::boolean, false);
  end if;

$q$ || a1);
  v_def := replace(v_def, a2, $q$  if public.ferias_nivel_bloqueado(v_l.tenant_id, v_l.user_id) then
    v_val := public.ferias_decimo_prazo_da_escolha(v_l.tenant_id, v_l.user_id, v_val);
  end if;

$q$ || a2);
  execute v_def;
end
$do$;

revoke execute on function public.ferias_lancar(uuid, uuid, jsonb, date, text) from public, anon;
revoke execute on function public.ferias_reagendar(uuid, date, date, integer, boolean, date) from public, anon;
revoke execute on function public.ferias_reenviar(uuid, date, date, integer, boolean, date) from public, anon;

-- 5) o modelo do lote mostra a escolha (coluna de consulta)
do $do$
declare
  v_def text;
  a1 text := $q$'gozarAte', x.concessivo_fim)$q$;
  a2 text := $q$             a.aq_inicio, a.aq_fim, a.saldo, a.concessivo_fim
        from public.memberships m$q$;
begin
  v_def := pg_get_functiondef('public.ferias_modelo_lancamento(uuid, date)'::regprocedure);
  if strpos(v_def, a1) = 0 or strpos(v_def, a2) = 0 then
    raise exception 'ferias_modelo_lancamento: âncora não encontrada';
  end if;
  v_def := replace(v_def, a1, $q$'gozarAte', x.concessivo_fim, 'decimo', x.decimo)$q$);
  v_def := replace(v_def, a2, $q$             a.aq_inicio, a.aq_fim, a.saldo, a.concessivo_fim,
             (select string_agg(c.ano || ': ' || case when c.quer then 'quer adiantar' else 'não quer' end,
                                '; ' order by c.ano)
                from public.ferias_decimo_escolhas c
               where c.tenant_id = p_tenant and c.user_id = m.user_id
                 and c.ano >= extract(year from p_hoje)::int) as decimo
        from public.memberships m$q$);
  execute v_def;
end
$do$;

revoke execute on function public.ferias_modelo_lancamento(uuid, date) from public, anon;

-- 6) as RPCs da tela
create or replace function public.ferias_escolher_decimo(p_tenant uuid, p_ano int, p_quer boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_modo text;
  v_fora boolean;
  v_quer_atual boolean;
  v_choque record;
begin
  if v_uid is null or not public.is_tenant_member(p_tenant) then
    raise exception 'Você não é membro desta empresa.';
  end if;
  if not exists (select 1 from public.memberships m
                  where m.tenant_id = p_tenant and m.user_id = v_uid and m.is_active) then
    raise exception 'Vínculo não encontrado nesta empresa.';
  end if;
  if not public.ferias_nivel_bloqueado(p_tenant, v_uid) then
    raise exception 'O adiantamento do 13º você pede no próprio pedido de férias.';
  end if;
  if p_quer is null or p_ano is null
     or p_ano < extract(year from v_hoje)::int or p_ano > extract(year from v_hoje)::int + 1 then
    raise exception 'Escolha o adiantamento do 13º deste ano ou do próximo.';
  end if;

  select c.decimo_fora_prazo into v_modo from public.ferias_config c where c.tenant_id = p_tenant;
  v_modo := coalesce(v_modo, 'alerta');
  v_fora := v_hoje > make_date(p_ano, 1, 31);
  if v_fora and v_modo = 'bloquear' then
    raise exception 'O prazo para escolher o adiantamento do 13º com as férias de % terminou em 31/01/% (Lei 4.749/65). Fale com o departamento pessoal.',
      p_ano, p_ano;
  end if;

  select c.quer into v_quer_atual from public.ferias_decimo_escolhas c
   where c.tenant_id = p_tenant and c.user_id = v_uid and c.ano = p_ano;
  if found and v_quer_atual = p_quer then
    return;
  end if;

  if not p_quer then
    select f.start_date, f.end_date into v_choque
      from public.ferias_solicitacoes f
     where f.tenant_id = p_tenant and f.user_id = v_uid and f.status = 'efetivada'
       and f.adiantar_decimo_terceiro and extract(year from f.start_date) = p_ano
     order by f.start_date limit 1;
    if found then
      raise exception 'O adiantamento do 13º de % já foi efetivado pelo departamento pessoal nas férias de % a %. Para desistir, fale com o DP.',
        p_ano, to_char(v_choque.start_date, 'DD/MM/YYYY'), to_char(v_choque.end_date, 'DD/MM/YYYY');
    end if;
  end if;

  insert into public.ferias_decimo_escolhas (tenant_id, user_id, ano, quer, fora_prazo, escolhido_em, escolhido_por)
  values (p_tenant, v_uid, p_ano, p_quer, v_fora, now(), v_uid)
  on conflict (tenant_id, user_id, ano) do update
     set quer = excluded.quer, fora_prazo = excluded.fora_prazo,
         escolhido_em = excluded.escolhido_em, escolhido_por = excluded.escolhido_por;

  perform public.ferias_decimo_sincronizar(p_tenant, v_uid, p_ano);
end;
$function$;

revoke execute on function public.ferias_escolher_decimo(uuid, int, boolean) from public, anon;
grant execute on function public.ferias_escolher_decimo(uuid, int, boolean) to authenticated;

-- a própria pessoa, o gestor dela ou o DP
create or replace function public.ferias_escolhas_decimo(p_tenant uuid, p_user uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
begin
  if not (
       (p_user = (select auth.uid()) and public.is_tenant_member(p_tenant))
       or public.manages_user(p_user, p_tenant)
       or public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[])) then
    raise exception 'Sem permissão.';
  end if;

  return jsonb_build_object(
    'bloqueado', public.ferias_nivel_bloqueado(p_tenant, p_user),
    'escolhas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ano', c.ano, 'quer', c.quer, 'foraPrazo', c.fora_prazo, 'escolhidoEm', c.escolhido_em)
               order by c.ano)
        from public.ferias_decimo_escolhas c
       where c.tenant_id = p_tenant and c.user_id = p_user), '[]'::jsonb));
end;
$function$;

revoke execute on function public.ferias_escolhas_decimo(uuid, uuid) from public, anon;
grant execute on function public.ferias_escolhas_decimo(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
