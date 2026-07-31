create or replace function public.save_meeting_series(p_data jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
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
    -- criação restrita: só owner, admin ou gerente
    if not public.has_tenant_role(v_tenant, array['owner','admin','manager']::public.member_role[]) then
      raise exception 'Apenas owner, administrador ou gerente podem criar reuniões';
    end if;
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
