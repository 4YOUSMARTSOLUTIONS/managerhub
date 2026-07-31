-- Antecipar reunião: iniciar antes da data agendada informando a próxima reunião.

alter table public.meeting_occurrences add column if not exists advance_on_finish boolean not null default true;

-- inicia agora ignorando a trava de data futura; define manualmente a próxima reunião;
-- marca a ocorrência para NÃO reavançar no finish (a próxima já foi definida).
create or replace function public.anticipate_meeting_occurrence(
  p_series_id uuid,
  p_room_id uuid default null,
  p_link text default null,
  p_next_date date default null,
  p_next_time time default null
) returns uuid
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

  select id into v_existing from public.meeting_occurrences
   where series_id = v_series.id and status = 'in_progress' order by started_at desc limit 1;
  if v_existing is not null then return v_existing; end if;

  if p_room_id is not null then
    select name into v_room_name from public.rooms where id = p_room_id and tenant_id = v_series.tenant_id;
    if v_room_name is null then raise exception 'Sala inválida.'; end if;
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

  insert into public.meeting_occurrences (tenant_id, series_id, occurred_on, started_at, status, registered_by, room_id, meeting_link, booking_meeting_id, advance_on_finish)
  values (v_series.tenant_id, v_series.id, current_date, now(), 'in_progress', v_uid, p_room_id, nullif(trim(p_link),''), v_booking, false)
  returning id into v_occ;

  if p_next_date is not null then
    update public.meeting_series
       set next_date = p_next_date,
           start_time = coalesce(p_next_time, start_time)
     where id = v_series.id;
  end if;

  return v_occ;
end; $function$;

-- finish: não reavança a próxima data quando a ocorrência foi antecipada
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

  if coalesce((p_data->>'advance_next')::boolean, true)
     and coalesce(v_occ.advance_on_finish, true)
     and v_series.periodicity <> 'sob_demanda' then
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
