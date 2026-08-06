-- Problema/Diagnóstico no cabeçalho da ação.
--
-- Até aqui a ação dizia o que fazer e não dizia por quê: o único texto livre da
-- feature é action_demandas.description, a frase da tarefa. Quem recebe a demanda
-- lê "renegociar o contrato com o fornecedor X" e não sabe qual problema aquilo
-- resolve.
--
-- Fica no cabeçalho, não na demanda, porque uma ação agrupa N demandas e o
-- problema é o contexto comum a todas elas.
--
-- Opcional de propósito: as milhares de ações já importadas nascem com o campo
-- vazio, e é a RPC do fim deste arquivo que permite preenchê-las depois.

alter table public.actions
  add column if not exists problem_statement text;

comment on column public.actions.problem_statement is
  'Problema/diagnóstico que motivou a ação. Texto livre, opcional. É do cabeçalho, então vale para todas as demandas da ação.';

-- ---------------------------------------------------------------------------
-- create_action: grava o problema junto do resto do cabeçalho.
-- Cópia fiel de 20260802200000_actions_programa.sql com problem_statement a mais.
-- ---------------------------------------------------------------------------
create or replace function public.create_action(p_data jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.my_active_tenant();
  v_uid uuid := auth.uid();
  v_action uuid;
  v_dem uuid;
  v_dem_ids uuid[] := '{}';
  v_due date := nullif(p_data->>'due_date','')::date;
  d jsonb;
  v_sdpo boolean := coalesce((p_data->>'is_sdpo')::boolean, false);
begin
  if jsonb_array_length(coalesce(p_data->'demandas','[]'::jsonb)) = 0 then
    raise exception 'Informe ao menos uma ação';
  end if;

  insert into public.actions (
    tenant_id, is_sdpo, pilar_id, secao_id, bloco_id, item_id, programa_id,
    meeting_series_id, occurrence_id, kpi_id, tool_id, unit_id,
    requester_id, problem_statement, due_date, priority, created_by
  ) values (
    v_tenant, v_sdpo,
    case when v_sdpo then (select id from public.sdpo_pilares where id = nullif(p_data->>'pilar_id','')::uuid and tenant_id = v_tenant) end,
    case when v_sdpo then (select id from public.sdpo_secoes where id = nullif(p_data->>'secao_id','')::uuid and tenant_id = v_tenant) end,
    case when v_sdpo then (select id from public.sdpo_blocos where id = nullif(p_data->>'bloco_id','')::uuid and tenant_id = v_tenant) end,
    case when v_sdpo then (select id from public.sdpo_itens where id = nullif(p_data->>'item_id','')::uuid and tenant_id = v_tenant) end,
    case when v_sdpo then coalesce(
      (select i.programa_id from public.sdpo_itens i where i.id = nullif(p_data->>'item_id','')::uuid and i.tenant_id = v_tenant),
      (select b.programa_id from public.sdpo_blocos b where b.id = nullif(p_data->>'bloco_id','')::uuid and b.tenant_id = v_tenant)
    ) end,
    (select id from public.meeting_series where id = nullif(p_data->>'meeting_series_id','')::uuid and tenant_id = v_tenant),
    (select id from public.meeting_occurrences where id = nullif(p_data->>'occurrence_id','')::uuid and tenant_id = v_tenant),
    (select id from public.action_kpis where id = nullif(p_data->>'kpi_id','')::uuid and tenant_id = v_tenant),
    (select id from public.action_tools where id = nullif(p_data->>'tool_id','')::uuid and tenant_id = v_tenant),
    (select id from public.units where id = nullif(p_data->>'unit_id','')::uuid and tenant_id = v_tenant),
    (select m.user_id from public.memberships m where m.user_id = nullif(p_data->>'requester_id','')::uuid and m.tenant_id = v_tenant),
    nullif(trim(p_data->>'problem_statement'), ''),
    v_due, coalesce((p_data->>'priority')::public.priority_level, 'medium'), v_uid
  ) returning id into v_action;

  for d in select * from jsonb_array_elements(p_data->'demandas')
  loop
    if coalesce(trim(d->>'description'),'') = '' then continue; end if;
    insert into public.action_demandas (action_id, tenant_id, description, due_date)
    values (v_action, v_tenant, trim(d->>'description'), v_due)
    returning id into v_dem;
    v_dem_ids := array_append(v_dem_ids, v_dem);
    insert into public.action_demanda_assignees (demanda_id, user_id)
    select v_dem, x::uuid from jsonb_array_elements_text(coalesce(d->'assignees','[]'::jsonb)) x
    where exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = x::uuid)
    on conflict do nothing;
    insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body)
    values (v_tenant, v_dem, 'created', v_uid, trim(d->>'description'));
  end loop;

  insert into public.action_cc (action_id, user_id)
  select v_action, x::uuid from jsonb_array_elements_text(coalesce(p_data->'cc','[]'::jsonb)) x
  where exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = x::uuid)
  on conflict do nothing;

  return jsonb_build_object('action_id', v_action, 'demanda_ids', to_jsonb(v_dem_ids));
end; $function$;

-- ---------------------------------------------------------------------------
-- Preencher/corrigir o problema depois da criação.
--
-- Até aqui não existia NENHUM caminho de update de ação: create_action cria,
-- import_action importa, deleteAction apaga, e ponto. Sem isto o campo nasceria
-- "escreve uma vez e nunca mais", e todo o histórico importado ficaria sem
-- contexto para sempre.
--
-- Recebe a demanda e resolve a ação, que é a convenção de todas as outras RPCs
-- do painel (demanda_set_status, demanda_reassign, demanda_reopen...). O painel
-- só conhece o id da demanda.
--
-- Guarda igual à de demanda_reopen/demanda_reassign: solicitante ou owner/admin.
-- Sem trava por status: preencher retroativamente ação já concluída é justamente
-- o caso de uso principal.
-- ---------------------------------------------------------------------------
create or replace function public.demanda_set_problem(p_demanda uuid, p_texto text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant    uuid;
  v_action    uuid;
  v_requester uuid;
  v_uid       uuid := auth.uid();
  v_antes     text;
  v_novo      text := nullif(trim(p_texto), '');
begin
  select d.tenant_id, d.action_id, a.requester_id, a.problem_statement
    into v_tenant, v_action, v_requester, v_antes
  from public.action_demandas d
  join public.actions a on a.id = d.action_id
  where d.id = p_demanda;

  if v_tenant is null then
    raise exception 'Ação não encontrada';
  end if;
  if not public.is_tenant_member(v_tenant) then
    raise exception 'Sem permissão';
  end if;
  if not (v_uid = v_requester
          or public.has_tenant_role(v_tenant, array['owner','admin']::public.member_role[])) then
    raise exception 'Apenas o solicitante ou um administrador pode editar o problema';
  end if;
  if length(coalesce(v_novo, '')) > 4000 then
    raise exception 'O problema deve ter no máximo 4000 caracteres';
  end if;

  -- sem mudança real não gera linha de auditoria nem mexe no updated_at
  if v_novo is not distinct from v_antes then
    return;
  end if;

  -- public.actions não tem trigger set_updated_at (o único é actions_assign_code,
  -- before insert), então o updated_at é na mão.
  update public.actions
     set problem_statement = v_novo,
         updated_at = now()
   where id = v_action;
end; $function$;

-- AGENTS.md: SECURITY DEFINER em public sai do alcance da chave pública.
revoke execute on function public.create_action(jsonb) from public, anon;
grant  execute on function public.create_action(jsonb) to authenticated;
revoke execute on function public.demanda_set_problem(uuid, text) from public, anon;
grant  execute on function public.demanda_set_problem(uuid, text) to authenticated;

notify pgrst, 'reload schema';
