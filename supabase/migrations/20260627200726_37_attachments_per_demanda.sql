
-- anexo pode ser geral (demanda_id null) ou de uma demanda específica
alter table public.action_attachments
  add column if not exists demanda_id uuid references public.action_demandas(id) on delete cascade;

-- create_action passa a retornar { action_id, demanda_ids[] } (na ordem das demandas)
drop function if exists public.create_action(jsonb);
create function public.create_action(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.my_active_tenant();
  v_uid uuid := auth.uid();
  v_action uuid;
  v_dem uuid;
  v_dem_ids uuid[] := '{}';
  d jsonb;
  v_sdpo boolean := coalesce((p_data->>'is_sdpo')::boolean, false);
begin
  if jsonb_array_length(coalesce(p_data->'demandas','[]'::jsonb)) = 0 then
    raise exception 'Informe ao menos uma ação';
  end if;

  insert into public.actions (
    tenant_id, is_sdpo, pilar_id, bloco_id, item_id,
    meeting_series_id, occurrence_id, kpi_id, tool_id,
    requester_id, due_date, created_by
  ) values (
    v_tenant, v_sdpo,
    case when v_sdpo then nullif(p_data->>'pilar_id','')::uuid end,
    case when v_sdpo then nullif(p_data->>'bloco_id','')::uuid end,
    case when v_sdpo then nullif(p_data->>'item_id','')::uuid end,
    nullif(p_data->>'meeting_series_id','')::uuid,
    nullif(p_data->>'occurrence_id','')::uuid,
    nullif(p_data->>'kpi_id','')::uuid,
    nullif(p_data->>'tool_id','')::uuid,
    nullif(p_data->>'requester_id','')::uuid,
    nullif(p_data->>'due_date','')::date,
    v_uid
  ) returning id into v_action;

  for d in select * from jsonb_array_elements(p_data->'demandas')
  loop
    if coalesce(trim(d->>'description'),'') = '' then continue; end if;
    insert into public.action_demandas (action_id, tenant_id, description)
    values (v_action, v_tenant, trim(d->>'description'))
    returning id into v_dem;
    v_dem_ids := array_append(v_dem_ids, v_dem);
    insert into public.action_demanda_assignees (demanda_id, user_id)
    select v_dem, x::uuid from jsonb_array_elements_text(coalesce(d->'assignees','[]'::jsonb)) x
    on conflict do nothing;
  end loop;

  insert into public.action_cc (action_id, user_id)
  select v_action, x::uuid from jsonb_array_elements_text(coalesce(p_data->'cc','[]'::jsonb)) x
  on conflict do nothing;

  return jsonb_build_object('action_id', v_action, 'demanda_ids', to_jsonb(v_dem_ids));
end; $$;
revoke all on function public.create_action(jsonb) from public, anon;
grant execute on function public.create_action(jsonb) to authenticated;

notify pgrst, 'reload schema';

