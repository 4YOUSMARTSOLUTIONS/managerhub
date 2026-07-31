alter table public.meeting_occurrences add column if not exists transcript text;

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
    set status = 'finished',
        ended_at = now(),
        notes = nullif(p_data->>'notes',''),
        decisions = nullif(p_data->>'decisions',''),
        transcript = nullif(p_data->>'transcript',''),
        duration_seconds = greatest(0, extract(epoch from (now() - coalesce(v_occ.started_at, now())))::int),
        draft = null
    where id = v_occ.id;

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
