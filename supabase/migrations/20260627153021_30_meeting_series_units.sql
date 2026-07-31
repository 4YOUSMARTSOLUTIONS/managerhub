
-- Unidades às quais a reunião se aplica (N:N)
create table if not exists public.meeting_series_units (
  series_id uuid not null references public.meeting_series(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  primary key (series_id, unit_id)
);
alter table public.meeting_series_units enable row level security;

drop policy if exists msu_rw on public.meeting_series_units;
create policy msu_rw on public.meeting_series_units
  for all using (exists (select 1 from public.meeting_series s where s.id = series_id and public.is_tenant_member(s.tenant_id)))
  with check (exists (select 1 from public.meeting_series s where s.id = series_id and public.is_tenant_member(s.tenant_id)));

grant select, insert, update, delete on public.meeting_series_units to authenticated;

-- save_meeting_series também substitui as unidades
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
    insert into public.meeting_series (
      tenant_id, name, periodicity, next_date,
      objetivo, owner, room_id, is_online, participants_text,
      duration_min, duration_unit,
      content, general_rules, how_to, created_by
    ) values (
      v_tenant, trim(p_data->>'name'),
      coalesce((p_data->>'periodicity')::public.meeting_periodicity, 'mensal'),
      nullif(p_data->>'next_date','')::date,
      nullif(p_data->>'objetivo',''), nullif(p_data->>'owner',''),
      nullif(p_data->>'room_id','')::uuid, coalesce((p_data->>'is_online')::boolean, false),
      nullif(p_data->>'participants_text',''),
      nullif(p_data->>'duration_min','')::int, coalesce(nullif(p_data->>'duration_unit',''), 'min'),
      coalesce(p_data->'content','[]'::jsonb),
      coalesce(p_data->'general_rules','[]'::jsonb),
      coalesce(p_data->'how_to','[]'::jsonb),
      v_uid
    )
    returning id into v_id;
  else
    update public.meeting_series set
      name = trim(p_data->>'name'),
      periodicity = coalesce((p_data->>'periodicity')::public.meeting_periodicity, periodicity),
      next_date = nullif(p_data->>'next_date','')::date,
      objetivo = nullif(p_data->>'objetivo',''),
      owner = nullif(p_data->>'owner',''),
      room_id = nullif(p_data->>'room_id','')::uuid,
      is_online = coalesce((p_data->>'is_online')::boolean, false),
      participants_text = nullif(p_data->>'participants_text',''),
      duration_min = nullif(p_data->>'duration_min','')::int,
      duration_unit = coalesce(nullif(p_data->>'duration_unit',''), 'min'),
      content = coalesce(p_data->'content','[]'::jsonb),
      general_rules = coalesce(p_data->'general_rules','[]'::jsonb),
      how_to = coalesce(p_data->'how_to','[]'::jsonb)
    where id = v_id and public.is_tenant_member(tenant_id);
    if not found then raise exception 'Reunião não encontrada'; end if;
  end if;

  delete from public.meeting_series_participants where series_id = v_id;
  insert into public.meeting_series_participants (series_id, user_id)
  select v_id, x::uuid
  from jsonb_array_elements_text(coalesce(p_data->'participants','[]'::jsonb)) x
  on conflict do nothing;

  delete from public.meeting_series_units where series_id = v_id;
  insert into public.meeting_series_units (series_id, unit_id)
  select v_id, x::uuid
  from jsonb_array_elements_text(coalesce(p_data->'units','[]'::jsonb)) x
  on conflict do nothing;

  return v_id;
end; $$;
revoke all on function public.save_meeting_series(jsonb) from public, anon;
grant execute on function public.save_meeting_series(jsonb) to authenticated;

notify pgrst, 'reload schema';

