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

  -- já há uma em andamento dessa série? devolve ela (resumível)
  select id into v_existing
  from public.meeting_occurrences
  where series_id = v_series.id and status = 'in_progress'
  order by started_at desc limit 1;
  if v_existing is not null then return v_existing; end if;

  -- não permite iniciar antes da data agendada
  if v_series.next_date is not null and v_series.next_date > current_date then
    raise exception 'A próxima reunião está agendada para %. Para iniciar antes, edite a data da próxima reunião.', to_char(v_series.next_date, 'DD/MM/YYYY');
  end if;

  insert into public.meeting_occurrences (tenant_id, series_id, occurred_on, started_at, status, registered_by)
  values (v_series.tenant_id, v_series.id, current_date, now(), 'in_progress', v_uid)
  returning id into v_occ;

  return v_occ;
end; $$;
