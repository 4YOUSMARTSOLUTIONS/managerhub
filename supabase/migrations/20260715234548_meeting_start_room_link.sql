alter table public.meeting_occurrences
  add column if not exists room_id uuid references public.rooms(id) on delete set null,
  add column if not exists meeting_link text,
  add column if not exists booking_meeting_id uuid references public.meetings(id) on delete set null;

-- INICIAR: aceita sala (reserva no calendário) e link opcional
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

  -- sala informada no início: reserva no calendário (booking standalone com o nome da reunião)
  if p_room_id is not null then
    if not exists (select 1 from public.rooms where id = p_room_id and tenant_id = v_series.tenant_id) then
      raise exception 'Sala inválida.';
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

-- FINALIZAR: encerra a reserva da sala
create or replace function public.finish_meeting_occurrence(p_data jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_occ public.meeting_occurrences;
  v_series public.meeting_series;
begin
  select * into v_occ from public.meeting_occurrences where id = (p_data->>'occurrence_id')::uuid;
  if v_occ.id is null then raise exception 'Ocorrência não encontrada'; end if;
  if not public.is_tenant_member(v_occ.tenant_id) then raise exception 'Sem permissão'; end if;
  if v_occ.status <> 'in_progress' then raise exception 'Esta reunião não está em andamento.'; end if;

  select * into v_series from public.meeting_series where id = v_occ.series_id;

  update public.meeting_occurrences
    set status = 'finished', ended_at = now(),
        notes = nullif(p_data->>'notes',''),
        decisions = nullif(p_data->>'decisions',''),
        transcript = nullif(p_data->>'transcript',''),
        duration_seconds = greatest(0, extract(epoch from (now() - coalesce(v_occ.started_at, now())))::int),
        draft = null
    where id = v_occ.id;

  if v_occ.booking_meeting_id is not null then
    update public.meetings set status = 'done', ends_at = now()
    where id = v_occ.booking_meeting_id and status <> 'cancelled';
  end if;

  delete from public.meeting_attendance where occurrence_id = v_occ.id;
  insert into public.meeting_attendance (occurrence_id, user_id, present)
  select v_occ.id, (x->>'user_id')::uuid, coalesce((x->>'present')::boolean, true)
  from jsonb_array_elements(coalesce(p_data->'attendance','[]'::jsonb)) x
  on conflict do nothing;

  if coalesce((p_data->>'advance_next')::boolean, true) and v_series.periodicity <> 'sob_demanda' then
    update public.meeting_series set next_date = (v_occ.occurred_on + case v_series.periodicity
        when 'diaria' then interval '1 day' when 'semanal' then interval '7 days'
        when 'quinzenal' then interval '14 days' when 'mensal' then interval '1 month'
        when 'bimestral' then interval '2 months' when 'trimestral' then interval '3 months'
        when 'semestral' then interval '6 months' when 'anual' then interval '1 year'
        else interval '0 day' end)::date
    where id = v_series.id;
  end if;

  return v_occ.id;
end; $function$;

-- CANCELAR: libera a reserva
create or replace function public.cancel_meeting_occurrence(p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_occ public.meeting_occurrences;
begin
  select * into v_occ from public.meeting_occurrences where id = p_id;
  if v_occ.id is null then raise exception 'Ocorrência não encontrada'; end if;
  if not public.is_tenant_member(v_occ.tenant_id) then raise exception 'Sem permissão'; end if;
  update public.meeting_occurrences set status = 'cancelled', ended_at = now(), draft = null where id = v_occ.id;
  if v_occ.booking_meeting_id is not null then
    update public.meetings set status = 'cancelled' where id = v_occ.booking_meeting_id;
  end if;
end; $function$;

-- AUTO-FINALIZAR: também encerra a reserva
create or replace function public.auto_finish_overdue_meetings()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record;
  v_count int := 0;
  v_draft jsonb;
  v_planned int;
begin
  for r in
    select o.id, o.started_at, o.occurred_on, o.draft, o.booking_meeting_id,
           s.id as series_id, s.periodicity,
           (coalesce(s.duration_min,0) * case when s.duration_unit = 'h' then 60 else 1 end) as planned_min
    from public.meeting_occurrences o
    join public.meeting_series s on s.id = o.series_id
    where o.status = 'in_progress' and o.started_at is not null and coalesce(s.duration_min,0) > 0
  loop
    v_planned := r.planned_min;
    if now() - r.started_at <= make_interval(mins => 3 * v_planned) then continue; end if;
    v_draft := coalesce(r.draft, '{}'::jsonb);

    update public.meeting_occurrences
      set status = 'finished', ended_at = now(), auto_finished = true,
          notes = coalesce(nullif(v_draft->>'notes',''), notes),
          decisions = coalesce(nullif(v_draft->>'decisions',''), decisions),
          transcript = coalesce(nullif(v_draft->>'transcript',''), transcript),
          duration_seconds = greatest(0, extract(epoch from (now() - r.started_at))::int),
          draft = null
      where id = r.id;

    if r.booking_meeting_id is not null then
      update public.meetings set status = 'done', ends_at = now()
      where id = r.booking_meeting_id and status <> 'cancelled';
    end if;

    if jsonb_typeof(v_draft->'attendees') = 'array' then
      insert into public.meeting_attendance (occurrence_id, user_id, present)
      select r.id, uid::uuid, coalesce((v_draft->'present'->>uid)::boolean, true)
      from jsonb_array_elements_text(v_draft->'attendees') as t(uid)
      on conflict do nothing;
    end if;

    if r.periodicity <> 'sob_demanda' then
      update public.meeting_series set next_date = (r.occurred_on + case r.periodicity
          when 'diaria' then interval '1 day' when 'semanal' then interval '7 days'
          when 'quinzenal' then interval '14 days' when 'mensal' then interval '1 month'
          when 'bimestral' then interval '2 months' when 'trimestral' then interval '3 months'
          when 'semestral' then interval '6 months' when 'anual' then interval '1 year'
          else interval '0 day' end)::date
      where id = r.series_id;
    end if;

    v_count := v_count + 1;
  end loop;
  return v_count;
end; $function$;
