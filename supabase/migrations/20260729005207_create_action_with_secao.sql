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
    tenant_id, is_sdpo, pilar_id, secao_id, bloco_id, item_id,
    meeting_series_id, occurrence_id, kpi_id, tool_id, unit_id,
    requester_id, due_date, priority, created_by
  ) values (
    v_tenant, v_sdpo,
    case when v_sdpo then (select id from public.sdpo_pilares where id = nullif(p_data->>'pilar_id','')::uuid and tenant_id = v_tenant) end,
    case when v_sdpo then (select id from public.sdpo_secoes where id = nullif(p_data->>'secao_id','')::uuid and tenant_id = v_tenant) end,
    case when v_sdpo then (select id from public.sdpo_blocos where id = nullif(p_data->>'bloco_id','')::uuid and tenant_id = v_tenant) end,
    case when v_sdpo then (select id from public.sdpo_itens where id = nullif(p_data->>'item_id','')::uuid and tenant_id = v_tenant) end,
    (select id from public.meeting_series where id = nullif(p_data->>'meeting_series_id','')::uuid and tenant_id = v_tenant),
    (select id from public.meeting_occurrences where id = nullif(p_data->>'occurrence_id','')::uuid and tenant_id = v_tenant),
    (select id from public.action_kpis where id = nullif(p_data->>'kpi_id','')::uuid and tenant_id = v_tenant),
    (select id from public.action_tools where id = nullif(p_data->>'tool_id','')::uuid and tenant_id = v_tenant),
    (select id from public.units where id = nullif(p_data->>'unit_id','')::uuid and tenant_id = v_tenant),
    (select m.user_id from public.memberships m where m.user_id = nullif(p_data->>'requester_id','')::uuid and m.tenant_id = v_tenant),
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
