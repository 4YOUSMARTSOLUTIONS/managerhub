
-- Salva (cria/edita) uma reunião recorrente + participantes habituais
create or replace function public.save_meeting_series(p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p_data->>'id','')::uuid;
  v_tenant uuid;
  v_uid uuid := auth.uid();
begin
  if coalesce(trim(p_data->>'name'),'') = '' then
    raise exception 'Informe o nome da reunião';
  end if;

  if v_id is null then
    v_tenant := public.my_active_tenant();
    insert into public.meeting_series (tenant_id, name, periodicity, next_date, standard, created_by)
    values (
      v_tenant, trim(p_data->>'name'),
      coalesce((p_data->>'periodicity')::public.meeting_periodicity, 'mensal'),
      nullif(p_data->>'next_date','')::date,
      nullif(p_data->>'standard',''),
      v_uid
    )
    returning id into v_id;
  else
    update public.meeting_series set
      name = trim(p_data->>'name'),
      periodicity = coalesce((p_data->>'periodicity')::public.meeting_periodicity, periodicity),
      next_date = nullif(p_data->>'next_date','')::date,
      standard = nullif(p_data->>'standard','')
    where id = v_id and public.is_tenant_member(tenant_id);
    if not found then raise exception 'Reunião não encontrada'; end if;
  end if;

  -- participantes habituais (substitui)
  delete from public.meeting_series_participants where series_id = v_id;
  insert into public.meeting_series_participants (series_id, user_id)
  select v_id, x::uuid
  from jsonb_array_elements_text(coalesce(p_data->'participants','[]'::jsonb)) x
  on conflict do nothing;

  return v_id;
end; $$;
revoke all on function public.save_meeting_series(jsonb) from public, anon;
grant execute on function public.save_meeting_series(jsonb) to authenticated;

-- Registra o acontecimento de uma reunião (presença + decisões + ações + avança próxima data)
create or replace function public.register_meeting_occurrence(p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_series public.meeting_series;
  v_occ uuid;
  v_uid uuid := auth.uid();
  v_when date := coalesce((p_data->>'occurred_on')::date, current_date);
  a jsonb;
begin
  select * into v_series from public.meeting_series where id = (p_data->>'series_id')::uuid;
  if v_series.id is null then raise exception 'Reunião não encontrada'; end if;
  if not public.is_tenant_member(v_series.tenant_id) then raise exception 'Sem permissão'; end if;

  insert into public.meeting_occurrences (tenant_id, series_id, occurred_on, notes, decisions, registered_by)
  values (v_series.tenant_id, v_series.id, v_when,
          nullif(p_data->>'notes',''), nullif(p_data->>'decisions',''), v_uid)
  returning id into v_occ;

  insert into public.meeting_attendance (occurrence_id, user_id, present)
  select v_occ, (x->>'user_id')::uuid, coalesce((x->>'present')::boolean, true)
  from jsonb_array_elements(coalesce(p_data->'attendance','[]'::jsonb)) x
  on conflict do nothing;

  for a in select * from jsonb_array_elements(coalesce(p_data->'actions','[]'::jsonb))
  loop
    if coalesce(trim(a->>'title'),'') <> '' then
      insert into public.action_items (tenant_id, title, assignee_id, due_date, created_by, occurrence_id)
      values (v_series.tenant_id, trim(a->>'title'),
              nullif(a->>'assignee_id','')::uuid, nullif(a->>'due_date','')::date,
              v_uid, v_occ);
    end if;
  end loop;

  if coalesce((p_data->>'advance_next')::boolean, true) and v_series.periodicity <> 'sob_demanda' then
    update public.meeting_series set next_date = (v_when + case v_series.periodicity
        when 'diaria' then interval '1 day'
        when 'semanal' then interval '7 days'
        when 'quinzenal' then interval '14 days'
        when 'mensal' then interval '1 month'
        when 'bimestral' then interval '2 months'
        when 'trimestral' then interval '3 months'
        when 'semestral' then interval '6 months'
        when 'anual' then interval '1 year'
        else interval '0 day' end)::date
    where id = v_series.id;
  end if;

  return v_occ;
end; $$;
revoke all on function public.register_meeting_occurrence(jsonb) from public, anon;
grant execute on function public.register_meeting_occurrence(jsonb) to authenticated;

notify pgrst, 'reload schema';

