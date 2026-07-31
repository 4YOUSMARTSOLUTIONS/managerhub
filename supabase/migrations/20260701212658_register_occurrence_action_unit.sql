create or replace function public.register_meeting_occurrence(p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_series public.meeting_series;
  v_occ uuid;
  v_uid uuid := auth.uid();
  v_when date := coalesce((p_data->>'occurred_on')::date, current_date);
  v_action uuid;
  v_dem uuid;
  a jsonb;
  v_units uuid[];
  v_action_unit uuid;
begin
  select * into v_series from public.meeting_series where id = (p_data->>'series_id')::uuid;
  if v_series.id is null then raise exception 'Reunião não encontrada'; end if;
  if not public.is_tenant_member(v_series.tenant_id) then raise exception 'Sem permissão'; end if;
  if v_when > current_date then raise exception 'Não é possível registrar uma reunião com data futura.'; end if;

  -- unidade herdada: 1 unidade -> essa; 0 ou 2+ -> null (geral / todas as unidades)
  select array_agg(unit_id) into v_units from public.meeting_series_units where series_id = v_series.id;
  v_action_unit := case when coalesce(array_length(v_units, 1), 0) = 1 then v_units[1] else null end;

  insert into public.meeting_occurrences (tenant_id, series_id, occurred_on, notes, decisions, registered_by)
  values (v_series.tenant_id, v_series.id, v_when, nullif(p_data->>'notes',''), nullif(p_data->>'decisions',''), v_uid)
  returning id into v_occ;

  insert into public.meeting_attendance (occurrence_id, user_id, present)
  select v_occ, (x->>'user_id')::uuid, coalesce((x->>'present')::boolean, true)
  from jsonb_array_elements(coalesce(p_data->'attendance','[]'::jsonb)) x
  on conflict do nothing;

  for a in select * from jsonb_array_elements(coalesce(p_data->'actions','[]'::jsonb))
  loop
    if coalesce(trim(a->>'title'),'') <> '' then
      insert into public.actions (tenant_id, is_sdpo, meeting_series_id, occurrence_id, unit_id, requester_id, due_date, created_by)
      values (v_series.tenant_id, false, v_series.id, v_occ, v_action_unit, v_uid, nullif(a->>'due_date','')::date, v_uid)
      returning id into v_action;
      insert into public.action_demandas (action_id, tenant_id, description, due_date)
      values (v_action, v_series.tenant_id, trim(a->>'title'), nullif(a->>'due_date','')::date)
      returning id into v_dem;
      if coalesce(a->>'assignee_id','') <> '' and exists (
           select 1 from public.memberships m where m.tenant_id = v_series.tenant_id and m.user_id = (a->>'assignee_id')::uuid) then
        insert into public.action_demanda_assignees (demanda_id, user_id) values (v_dem, (a->>'assignee_id')::uuid) on conflict do nothing;
      end if;
      insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body) values (v_series.tenant_id, v_dem, 'created', v_uid, trim(a->>'title'));
    end if;
  end loop;

  if coalesce((p_data->>'advance_next')::boolean, true) and v_series.periodicity <> 'sob_demanda' then
    update public.meeting_series set next_date = greatest(
        coalesce(next_date, v_when),
        (v_when + case v_series.periodicity
          when 'diaria' then interval '1 day' when 'semanal' then interval '7 days'
          when 'quinzenal' then interval '14 days' when 'mensal' then interval '1 month'
          when 'bimestral' then interval '2 months' when 'trimestral' then interval '3 months'
          when 'semestral' then interval '6 months' when 'anual' then interval '1 year'
          else interval '0 day' end)::date)
    where id = v_series.id;
  end if;

  return v_occ;
end; $function$;
