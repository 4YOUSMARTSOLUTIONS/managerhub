-- Migração de ações de sistema antigo: preserva os valores do arquivo mesmo quando
-- não existe cadastro correspondente. Vincula (FK) quando o nome casa; senão, guarda o
-- texto original em colunas legacy_*. Colunas só usadas na importação; ações nativas não as tocam.

alter table public.actions
  add column if not exists legacy_pilar text,
  add column if not exists legacy_secao text,
  add column if not exists legacy_bloco text,
  add column if not exists legacy_item text,
  add column if not exists legacy_requester text,
  add column if not exists legacy_created_by text,
  add column if not exists legacy_meeting text,
  add column if not exists legacy_unit text,
  add column if not exists legacy_kpi text,
  add column if not exists legacy_tool text;

alter table public.action_demandas
  add column if not exists legacy_assignees text;

create or replace function public.import_action(p_data jsonb)
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
  v_due date := nullif(p_data->>'due_date','')::date;
  v_sdpo boolean := coalesce((p_data->>'is_sdpo')::boolean, false);
  v_created timestamptz := coalesce(nullif(p_data->>'created_at','')::timestamptz, now());
  v_creator uuid := coalesce(
    (select m.user_id from public.memberships m where m.user_id = nullif(p_data->>'created_by','')::uuid and m.tenant_id = v_tenant),
    v_uid);
  v_status public.action_status := coalesce(nullif(p_data->>'status','')::public.action_status, 'open');
  v_completed timestamptz := nullif(p_data->>'completed_at','')::timestamptz;
  v_awaiting boolean := coalesce((p_data->>'awaiting_approval')::boolean, false);
  v_dem_completed timestamptz;
  v_submitted timestamptz;
begin
  if not exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = v_uid and m.role = 'owner')
     and not public.is_super_admin() then
    raise exception 'Apenas o proprietário pode importar ações.';
  end if;
  if coalesce(trim(p_data->>'description'),'') = '' then
    raise exception 'Informe a descrição da ação';
  end if;

  v_dem_completed := case when v_status in ('done','cancelled') then coalesce(v_completed, v_created) else v_completed end;
  v_submitted := coalesce(v_completed, v_created);

  insert into public.actions (
    tenant_id, is_sdpo, pilar_id, secao_id, bloco_id, item_id,
    meeting_series_id, kpi_id, tool_id, unit_id, requester_id,
    due_date, priority, created_by, created_at, updated_at,
    legacy_pilar, legacy_secao, legacy_bloco, legacy_item, legacy_requester,
    legacy_created_by, legacy_meeting, legacy_unit, legacy_kpi, legacy_tool
  ) values (
    v_tenant, v_sdpo,
    (select id from public.sdpo_pilares where id = nullif(p_data->>'pilar_id','')::uuid and tenant_id = v_tenant),
    (select id from public.sdpo_secoes where id = nullif(p_data->>'secao_id','')::uuid and tenant_id = v_tenant),
    (select id from public.sdpo_blocos where id = nullif(p_data->>'bloco_id','')::uuid and tenant_id = v_tenant),
    (select id from public.sdpo_itens where id = nullif(p_data->>'item_id','')::uuid and tenant_id = v_tenant),
    (select id from public.meeting_series where id = nullif(p_data->>'meeting_series_id','')::uuid and tenant_id = v_tenant),
    (select id from public.action_kpis where id = nullif(p_data->>'kpi_id','')::uuid and tenant_id = v_tenant),
    (select id from public.action_tools where id = nullif(p_data->>'tool_id','')::uuid and tenant_id = v_tenant),
    (select id from public.units where id = nullif(p_data->>'unit_id','')::uuid and tenant_id = v_tenant),
    (select m.user_id from public.memberships m where m.user_id = nullif(p_data->>'requester_id','')::uuid and m.tenant_id = v_tenant),
    v_due, coalesce((p_data->>'priority')::public.priority_level, 'medium'),
    v_creator, v_created, v_created,
    nullif(p_data->>'legacy_pilar',''), nullif(p_data->>'legacy_secao',''), nullif(p_data->>'legacy_bloco',''),
    nullif(p_data->>'legacy_item',''), nullif(p_data->>'legacy_requester',''), nullif(p_data->>'legacy_created_by',''),
    nullif(p_data->>'legacy_meeting',''), nullif(p_data->>'legacy_unit',''), nullif(p_data->>'legacy_kpi',''),
    nullif(p_data->>'legacy_tool','')
  ) returning id into v_action;

  insert into public.action_demandas (action_id, tenant_id, description, due_date, status, completed_at, created_at, legacy_assignees)
  values (v_action, v_tenant, trim(p_data->>'description'), v_due, v_status, v_dem_completed, v_created, nullif(p_data->>'legacy_assignees',''))
  returning id into v_dem;

  insert into public.action_demanda_assignees (demanda_id, user_id, done_requested_at, completed_at)
  select v_dem, x::uuid,
    case when v_awaiting then v_submitted when v_status = 'done' then coalesce(v_completed, v_created) else null end,
    case when v_status = 'done' then coalesce(v_completed, v_created) else null end
  from jsonb_array_elements_text(coalesce(p_data->'assignees','[]'::jsonb)) x
  where exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = x::uuid)
  on conflict do nothing;

  insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body, created_at)
  values (v_tenant, v_dem, 'created', v_creator, trim(p_data->>'description'), v_created);

  if v_awaiting then
    insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, meta, created_at)
    select v_tenant, v_dem, 'conclusao_requested', x::uuid, jsonb_build_object('user', x), v_submitted
    from jsonb_array_elements_text(coalesce(p_data->'assignees','[]'::jsonb)) x
    where exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = x::uuid);
  end if;

  insert into public.action_cc (action_id, user_id)
  select v_action, x::uuid from jsonb_array_elements_text(coalesce(p_data->'cc','[]'::jsonb)) x
  where exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = x::uuid)
  on conflict do nothing;

  return jsonb_build_object('action_id', v_action, 'demanda_ids', to_jsonb(array[v_dem]));
end; $function$;
