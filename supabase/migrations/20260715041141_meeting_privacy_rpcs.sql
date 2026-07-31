-- save_meeting_series: passa a gravar is_private
create or replace function public.save_meeting_series(p_data jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid := nullif(p_data->>'id','')::uuid;
  v_tenant uuid;
  v_uid uuid := auth.uid();
begin
  if coalesce(trim(p_data->>'name'),'') = '' then
    raise exception 'Informe o nome da reunião';
  end if;

  if v_id is null then
    v_tenant := public.my_active_tenant();
    insert into public.meeting_series (
      tenant_id, name, periodicity, next_date, start_time, auto_book,
      objetivo, owner, owner_user_id, room_id, is_online, participants_text,
      duration_min, duration_unit,
      content, general_rules, how_to, is_private, created_by
    ) values (
      v_tenant, trim(p_data->>'name'),
      coalesce((p_data->>'periodicity')::public.meeting_periodicity, 'mensal'),
      nullif(p_data->>'next_date','')::date,
      nullif(p_data->>'start_time','')::time,
      coalesce((p_data->>'auto_book')::boolean, false),
      nullif(p_data->>'objetivo',''), nullif(p_data->>'owner',''),
      nullif(p_data->>'owner_user_id','')::uuid,
      nullif(p_data->>'room_id','')::uuid, coalesce((p_data->>'is_online')::boolean, false),
      nullif(p_data->>'participants_text',''),
      nullif(p_data->>'duration_min','')::int, coalesce(nullif(p_data->>'duration_unit',''), 'min'),
      coalesce(p_data->'content','[]'::jsonb),
      coalesce(p_data->'general_rules','[]'::jsonb),
      coalesce(p_data->'how_to','[]'::jsonb),
      coalesce((p_data->>'is_private')::boolean, false),
      v_uid
    )
    returning id into v_id;
  else
    update public.meeting_series set
      name = trim(p_data->>'name'),
      periodicity = coalesce((p_data->>'periodicity')::public.meeting_periodicity, periodicity),
      next_date = nullif(p_data->>'next_date','')::date,
      start_time = nullif(p_data->>'start_time','')::time,
      auto_book = coalesce((p_data->>'auto_book')::boolean, false),
      objetivo = nullif(p_data->>'objetivo',''),
      owner = nullif(p_data->>'owner',''),
      owner_user_id = nullif(p_data->>'owner_user_id','')::uuid,
      room_id = nullif(p_data->>'room_id','')::uuid,
      is_online = coalesce((p_data->>'is_online')::boolean, false),
      participants_text = nullif(p_data->>'participants_text',''),
      duration_min = nullif(p_data->>'duration_min','')::int,
      duration_unit = coalesce(nullif(p_data->>'duration_unit',''), 'min'),
      content = coalesce(p_data->'content','[]'::jsonb),
      general_rules = coalesce(p_data->'general_rules','[]'::jsonb),
      how_to = coalesce(p_data->'how_to','[]'::jsonb),
      is_private = coalesce((p_data->>'is_private')::boolean, false)
    where id = v_id and public.is_tenant_member(tenant_id);
    if not found then raise exception 'Reunião não encontrada'; end if;
  end if;

  delete from public.meeting_series_participants where series_id = v_id;
  insert into public.meeting_series_participants (series_id, user_id)
  select v_id, x::uuid from jsonb_array_elements_text(coalesce(p_data->'participants','[]'::jsonb)) x
  on conflict do nothing;

  delete from public.meeting_series_units where series_id = v_id;
  insert into public.meeting_series_units (series_id, unit_id)
  select v_id, x::uuid from jsonb_array_elements_text(coalesce(p_data->'units','[]'::jsonb)) x
  on conflict do nothing;

  return v_id;
end; $function$;

-- dashboard_stats: contagens de ações respeitam a privacidade (can_view_action)
create or replace function public.dashboard_stats(p_tenant uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case when public.is_tenant_member(p_tenant) then jsonb_build_object(
    'rooms_total',        (select count(*) from public.rooms where tenant_id = p_tenant and is_active),
    'meetings_upcoming',  (select count(*) from public.meetings where tenant_id = p_tenant and status = 'scheduled' and starts_at >= now()),
    'meetings_today',     (select count(*) from public.meetings where tenant_id = p_tenant and starts_at::date = now()::date and status <> 'cancelled'),
    'actions_open',       (select count(*) from public.action_demandas d join public.actions a on a.id = d.action_id
                             where d.tenant_id = p_tenant and d.status not in ('done','cancelled') and public.can_view_action(a.*)),
    'actions_overdue',    (select count(*) from public.action_demandas d join public.actions a on a.id = d.action_id
                             where d.tenant_id = p_tenant and d.status not in ('done','cancelled') and d.due_date < now()::date and public.can_view_action(a.*)),
    'tickets_open',       (select count(*) from public.tickets where tenant_id = p_tenant and status in ('open','in_progress','waiting')),
    'tickets_overdue',    (select count(*) from public.tickets where tenant_id = p_tenant and status in ('open','in_progress','waiting') and due_date < now()::date),
    'goals_active',       (select count(*) from public.goals where tenant_id = p_tenant and status = 'active'),
    'goals_at_risk',      (select count(*) from public.goals where tenant_id = p_tenant and status = 'at_risk'),
    'goals_achieved',     (select count(*) from public.goals where tenant_id = p_tenant and status = 'achieved'),
    'members_total',      (select count(*) from public.memberships where tenant_id = p_tenant and is_active = true)
  ) else '{}'::jsonb end;
$function$;
