create or replace function public.start_meeting_occurrence(p_series_id uuid, p_room_id uuid default null, p_link text default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_series public.meeting_series;
  v_uid uuid := auth.uid();
  v_existing uuid;
  v_occ uuid;
  v_booking uuid := null;
  v_planned int;
  v_room_name text;
begin
  select * into v_series from public.meeting_series where id = p_series_id;
  if v_series.id is null then raise exception 'Reunião não encontrada'; end if;
  if not public.is_tenant_member(v_series.tenant_id) then raise exception 'Sem permissão'; end if;

  select id into v_existing
  from public.meeting_occurrences
  where series_id = v_series.id and status = 'in_progress'
  order by started_at desc limit 1;
  if v_existing is not null then return v_existing; end if;

  if v_series.next_date is not null and v_series.next_date > current_date then
    raise exception 'A próxima reunião está agendada para %. Para iniciar antes, edite a data da próxima reunião.', to_char(v_series.next_date, 'DD/MM/YYYY');
  end if;

  if p_room_id is not null then
    select name into v_room_name from public.rooms where id = p_room_id and tenant_id = v_series.tenant_id;
    if v_room_name is null then raise exception 'Sala inválida.'; end if;

    -- impede iniciar numa sala já ocupada neste horário
    if exists (
      select 1 from public.meetings m
      where m.room_id = p_room_id and m.status <> 'cancelled'
        and now() >= m.starts_at and now() < m.ends_at
    ) then
      raise exception 'A sala % já está ocupada neste horário. Escolha outra sala ou libere a reserva.', v_room_name;
    end if;

    v_planned := coalesce(v_series.duration_min * case when v_series.duration_unit = 'h' then 60 else 1 end, 60);
    if v_planned <= 0 then v_planned := 60; end if;
    insert into public.meetings (tenant_id, title, room_id, organizer_id, created_by, starts_at, ends_at, status, ics_sequence, series_detached)
    values (v_series.tenant_id, v_series.name, p_room_id, v_uid, v_uid, now(), now() + make_interval(mins => v_planned), 'in_progress', 0, true)
    returning id into v_booking;
  end if;

  insert into public.meeting_occurrences (tenant_id, series_id, occurred_on, started_at, status, registered_by, room_id, meeting_link, booking_meeting_id)
  values (v_series.tenant_id, v_series.id, current_date, now(), 'in_progress', v_uid, p_room_id, nullif(trim(p_link),''), v_booking)
  returning id into v_occ;

  return v_occ;
end; $function$;
