-- Slot original na grade da série (para reconhecer a ocorrência mesmo se movida)
-- e flag de "destacada" (usuário editou/moveu/cancelou manualmente).
alter table public.meetings
  add column if not exists series_slot timestamptz,
  add column if not exists series_detached boolean not null default false;

-- Backfill: reservas de série já existentes assumem slot = horário atual.
update public.meetings
   set series_slot = starts_at
 where series_id is not null and series_slot is null
   and status = 'scheduled' and starts_at >= date_trunc('day', now());

create or replace function public.sync_series_bookings(p_series uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.meeting_series%rowtype;
  v_step interval;
  v_dur interval;
  v_horizon date;
  d timestamptz;
  v_slot timestamptz;
  v_guard int;
  v_targets timestamptz[] := array[]::timestamptz[];
  v_mid uuid;
begin
  select * into s from public.meeting_series where id = p_series;
  if not found then return; end if;

  if auth.uid() is not null and not public.is_tenant_member(s.tenant_id) then
    return;
  end if;

  v_step := case s.periodicity
    when 'diaria' then interval '1 day'
    when 'semanal' then interval '7 days'
    when 'quinzenal' then interval '14 days'
    when 'mensal' then interval '1 month'
    when 'bimestral' then interval '2 months'
    when 'trimestral' then interval '3 months'
    when 'semestral' then interval '6 months'
    when 'anual' then interval '1 year'
    else null end;

  -- desligado: remove só as reservas geradas (não destacadas); preserva as editadas
  if (not s.is_active) or (not coalesce(s.auto_book, false))
     or s.next_date is null or s.start_time is null or v_step is null then
    delete from public.meetings
     where series_id = p_series and series_slot is not null and not series_detached
       and status = 'scheduled' and starts_at >= date_trunc('day', now());
    return;
  end if;

  v_horizon := case when s.periodicity = 'diaria'
                    then (current_date + interval '1 month')::date
                    else (current_date + interval '12 months')::date end;

  v_dur := make_interval(mins => coalesce(s.duration_min, 60) * case when s.duration_unit = 'h' then 60 else 1 end);
  if v_dur <= interval '0' then v_dur := interval '60 minutes'; end if;

  d := ((s.next_date::text) || ' ' || (s.start_time::text))::timestamp at time zone 'America/Sao_Paulo';
  while d < date_trunc('day', now()) loop
    d := d + v_step;
  end loop;

  -- grade com deslocamento p/ próximo dia útil (domingo/feriado)
  while d::date <= v_horizon loop
    v_slot := d;
    v_guard := 0;
    while (extract(dow from v_slot) = 0 or public.is_holiday(s.tenant_id, v_slot::date)) and v_guard < 15 loop
      v_slot := v_slot + interval '1 day';
      v_guard := v_guard + 1;
    end loop;
    if not (v_slot = any(v_targets)) then
      v_targets := array_append(v_targets, v_slot);
    end if;
    d := d + v_step;
  end loop;

  -- remove reservas geradas (não destacadas) cujo slot saiu da grade
  delete from public.meetings
   where series_id = p_series and series_slot is not null and not series_detached
     and status = 'scheduled' and starts_at >= date_trunc('day', now())
     and not (series_slot = any(v_targets));

  -- insere os slots faltantes; se já existe QUALQUER linha nesse slot
  -- (inclusive movida/cancelada/destacada), não recria
  foreach v_slot in array v_targets loop
    if not exists (select 1 from public.meetings where series_id = p_series and series_slot = v_slot) then
      begin
        insert into public.meetings (tenant_id, title, description, room_id, organizer_id, created_by, starts_at, ends_at, series_id, series_slot, status)
        values (s.tenant_id, s.name, s.objetivo,
                case when s.is_online then null else s.room_id end,
                s.owner_user_id, s.owner_user_id, v_slot, v_slot + v_dur, p_series, v_slot, 'scheduled')
        returning id into v_mid;

        insert into public.meeting_participants (meeting_id, user_id)
        select v_mid, msp.user_id from public.meeting_series_participants msp where msp.series_id = p_series
        on conflict do nothing;
      exception when others then
        null;
      end;
    end if;
  end loop;
end; $$;

notify pgrst, 'reload schema';
