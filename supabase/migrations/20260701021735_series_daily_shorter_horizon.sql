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
  v_targets timestamptz[] := array[]::timestamptz[];
  v_mid uuid;
begin
  select * into s from public.meeting_series where id = p_series;
  if not found then return; end if;

  -- chamada por usuário autenticado: só a própria empresa; via cron (uid null): liberado
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

  -- desligado (ou sob demanda / sem data / sem hora): remove reservas futuras agendadas e sai
  if (not s.is_active) or (not coalesce(s.auto_book, false))
     or s.next_date is null or s.start_time is null or v_step is null then
    delete from public.meetings
     where series_id = p_series and status = 'scheduled' and starts_at >= date_trunc('day', now());
    return;
  end if;

  -- horizonte: diária = 30 dias (evita ~365 reservas); demais = 12 meses
  v_horizon := case when s.periodicity = 'diaria'
                    then (current_date + interval '1 month')::date
                    else (current_date + interval '12 months')::date end;

  v_dur := make_interval(mins => coalesce(s.duration_min, 60) * case when s.duration_unit = 'h' then 60 else 1 end);
  if v_dur <= interval '0' then v_dur := interval '60 minutes'; end if;

  -- âncora na data/hora local de Brasília; avança até a primeira ocorrência futura
  d := ((s.next_date::text) || ' ' || (s.start_time::text))::timestamp at time zone 'America/Sao_Paulo';
  while d < date_trunc('day', now()) loop
    d := d + v_step;
  end loop;

  while d::date <= v_horizon loop
    v_targets := array_append(v_targets, d);
    d := d + v_step;
  end loop;

  -- remove reservas futuras que não batem mais com a grade (ex.: mudou horário/frequência)
  delete from public.meetings
   where series_id = p_series and status = 'scheduled'
     and starts_at >= date_trunc('day', now())
     and not (starts_at = any(v_targets));

  -- insere as que faltam (pula conflito de sala/horário)
  foreach d in array v_targets loop
    if not exists (select 1 from public.meetings where series_id = p_series and starts_at = d) then
      begin
        insert into public.meetings (tenant_id, title, description, room_id, organizer_id, created_by, starts_at, ends_at, series_id, status)
        values (s.tenant_id, s.name, s.objetivo,
                case when s.is_online then null else s.room_id end,
                s.owner_user_id, s.owner_user_id, d, d + v_dur, p_series, 'scheduled')
        returning id into v_mid;

        insert into public.meeting_participants (meeting_id, user_id)
        select v_mid, msp.user_id from public.meeting_series_participants msp where msp.series_id = p_series
        on conflict do nothing;
      exception when others then
        null; -- conflito de sala ou outro erro nesta ocorrência: pula
      end;
    end if;
  end loop;
end; $$;
