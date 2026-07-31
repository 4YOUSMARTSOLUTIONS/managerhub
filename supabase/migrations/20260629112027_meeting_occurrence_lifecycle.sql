-- 1. Enum de status da ocorrência
do $$ begin
  if not exists (select 1 from pg_type where typname = 'meeting_occurrence_status') then
    create type public.meeting_occurrence_status as enum ('in_progress', 'finished', 'cancelled');
  end if;
end $$;

-- 2. Colunas novas
alter table public.meeting_occurrences
  add column if not exists status public.meeting_occurrence_status not null default 'finished',
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists duration_seconds integer;

-- 3. Iniciar reunião (cria ocorrência em andamento)
create or replace function public.start_meeting_occurrence(p_series_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series public.meeting_series;
  v_uid uuid := auth.uid();
  v_existing uuid;
  v_occ uuid;
begin
  select * into v_series from public.meeting_series where id = p_series_id;
  if v_series.id is null then raise exception 'Reunião não encontrada'; end if;
  if not public.is_tenant_member(v_series.tenant_id) then raise exception 'Sem permissão'; end if;

  -- evita duplicar: se já há uma em andamento dessa série, devolve ela
  select id into v_existing
  from public.meeting_occurrences
  where series_id = v_series.id and status = 'in_progress'
  order by started_at desc limit 1;
  if v_existing is not null then return v_existing; end if;

  insert into public.meeting_occurrences (tenant_id, series_id, occurred_on, started_at, status, registered_by)
  values (v_series.tenant_id, v_series.id, current_date, now(), 'in_progress', v_uid)
  returning id into v_occ;

  return v_occ;
end; $$;

-- 4. Finalizar reunião (atualiza a ocorrência em andamento)
create or replace function public.finish_meeting_occurrence(p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
        duration_seconds = greatest(0, extract(epoch from (now() - coalesce(v_occ.started_at, now())))::int)
    where id = v_occ.id;

  -- regrava presença
  delete from public.meeting_attendance where occurrence_id = v_occ.id;
  insert into public.meeting_attendance (occurrence_id, user_id, present)
  select v_occ.id, (x->>'user_id')::uuid, coalesce((x->>'present')::boolean, true)
  from jsonb_array_elements(coalesce(p_data->'attendance','[]'::jsonb)) x
  on conflict do nothing;

  -- avança próxima data
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
end; $$;

-- 5. Cancelar reunião em andamento (mantém no histórico)
create or replace function public.cancel_meeting_occurrence(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ public.meeting_occurrences;
begin
  select * into v_occ from public.meeting_occurrences where id = p_id;
  if v_occ.id is null then raise exception 'Ocorrência não encontrada'; end if;
  if not public.is_tenant_member(v_occ.tenant_id) then raise exception 'Sem permissão'; end if;
  update public.meeting_occurrences set status = 'cancelled', ended_at = now() where id = v_occ.id;
end; $$;

grant execute on function public.start_meeting_occurrence(uuid) to authenticated;
grant execute on function public.finish_meeting_occurrence(jsonb) to authenticated;
grant execute on function public.cancel_meeting_occurrence(uuid) to authenticated;

notify pgrst, 'reload schema';
