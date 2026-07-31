alter table public.meeting_occurrences add column if not exists auto_finished boolean not null default false;

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
    select o.id, o.started_at, o.occurred_on, o.draft,
           s.id as series_id, s.periodicity,
           (coalesce(s.duration_min,0) * case when s.duration_unit = 'h' then 60 else 1 end) as planned_min
    from public.meeting_occurrences o
    join public.meeting_series s on s.id = o.series_id
    where o.status = 'in_progress'
      and o.started_at is not null
      and coalesce(s.duration_min,0) > 0
  loop
    v_planned := r.planned_min;
    -- fecha só se passou de 3x a duração planejada
    if now() - r.started_at <= make_interval(mins => 3 * v_planned) then
      continue;
    end if;

    v_draft := coalesce(r.draft, '{}'::jsonb);

    update public.meeting_occurrences
      set status = 'finished',
          ended_at = now(),
          auto_finished = true,
          notes = coalesce(nullif(v_draft->>'notes',''), notes),
          decisions = coalesce(nullif(v_draft->>'decisions',''), decisions),
          transcript = coalesce(nullif(v_draft->>'transcript',''), transcript),
          duration_seconds = greatest(0, extract(epoch from (now() - r.started_at))::int),
          draft = null
      where id = r.id;

    -- presença a partir do rascunho (se houver)
    if jsonb_typeof(v_draft->'attendees') = 'array' then
      insert into public.meeting_attendance (occurrence_id, user_id, present)
      select r.id, uid::uuid, coalesce((v_draft->'present'->>uid)::boolean, true)
      from jsonb_array_elements_text(v_draft->'attendees') as t(uid)
      on conflict do nothing;
    end if;

    -- avança a próxima reunião (mesma lógica do encerramento normal), exceto sob demanda
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

create extension if not exists pg_cron;

select cron.schedule('auto-finish-overdue-meetings', '*/5 * * * *', $$select public.auto_finish_overdue_meetings();$$);
