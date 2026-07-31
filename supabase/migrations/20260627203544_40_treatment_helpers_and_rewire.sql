
-- helper de notificação
create or replace function public.notify_users(p_tenant uuid, p_users uuid[], p_type text, p_title text, p_body text, p_demanda uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (tenant_id, user_id, type, title, body, demanda_id)
  select distinct p_tenant, u, p_type, p_title, p_body, p_demanda
  from unnest(p_users) u where u is not null;
$$;

-- create_action: prazo por demanda + prioridade + evento "criada"
drop function if exists public.create_action(jsonb);
create function public.create_action(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
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
    tenant_id, is_sdpo, pilar_id, bloco_id, item_id,
    meeting_series_id, occurrence_id, kpi_id, tool_id,
    requester_id, due_date, priority, created_by
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
    on conflict do nothing;
    insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body)
    values (v_tenant, v_dem, 'created', v_uid, trim(d->>'description'));
  end loop;

  insert into public.action_cc (action_id, user_id)
  select v_action, x::uuid from jsonb_array_elements_text(coalesce(p_data->'cc','[]'::jsonb)) x
  on conflict do nothing;

  return jsonb_build_object('action_id', v_action, 'demanda_ids', to_jsonb(v_dem_ids));
end; $$;
revoke all on function public.create_action(jsonb) from public, anon;
grant execute on function public.create_action(jsonb) to authenticated;

-- dashboard: overdue agora usa o prazo da demanda
drop function if exists public.dashboard_stats(uuid);
create function public.dashboard_stats(p_tenant uuid)
returns jsonb language sql security definer stable set search_path = public as $$
  select case when public.is_tenant_member(p_tenant) then jsonb_build_object(
    'rooms_total',        (select count(*) from public.rooms where tenant_id = p_tenant and is_active),
    'meetings_upcoming',  (select count(*) from public.meetings where tenant_id = p_tenant and status = 'scheduled' and starts_at >= now()),
    'meetings_today',     (select count(*) from public.meetings where tenant_id = p_tenant and starts_at::date = now()::date and status <> 'cancelled'),
    'actions_open',       (select count(*) from public.action_demandas where tenant_id = p_tenant and status not in ('done','cancelled')),
    'actions_overdue',    (select count(*) from public.action_demandas where tenant_id = p_tenant and status not in ('done','cancelled') and due_date < now()::date),
    'tickets_open',       (select count(*) from public.tickets where tenant_id = p_tenant and status in ('open','in_progress','waiting')),
    'tickets_overdue',    (select count(*) from public.tickets where tenant_id = p_tenant and status in ('open','in_progress','waiting') and due_date < now()::date),
    'goals_active',       (select count(*) from public.goals where tenant_id = p_tenant and status = 'active'),
    'goals_at_risk',      (select count(*) from public.goals where tenant_id = p_tenant and status = 'at_risk'),
    'goals_achieved',     (select count(*) from public.goals where tenant_id = p_tenant and status = 'achieved'),
    'members_total',      (select count(*) from public.memberships where tenant_id = p_tenant and is_active = true)
  ) else '{}'::jsonb end;
$$;
grant execute on function public.dashboard_stats(uuid) to authenticated;

notify pgrst, 'reload schema';

