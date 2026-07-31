
-- TOR (Termos de Referência) da reunião: substitui o "standard" por campos estruturados
alter table public.meeting_series
  add column if not exists objetivo text,
  add column if not exists owner text,
  add column if not exists location text,
  add column if not exists duration_min integer,
  add column if not exists kickoff text,
  add column if not exists content jsonb not null default '[]'::jsonb,
  add column if not exists general_rules jsonb not null default '[]'::jsonb,
  add column if not exists how_to jsonb not null default '[]'::jsonb;

alter table public.meeting_series drop column if exists standard;

-- Reescreve save_meeting_series para gravar o TOR completo
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
      objetivo, owner, location, duration_min, kickoff,
      content, general_rules, how_to, created_by
    ) values (
      v_tenant, trim(p_data->>'name'),
      coalesce((p_data->>'periodicity')::public.meeting_periodicity, 'mensal'),
      nullif(p_data->>'next_date','')::date,
      nullif(p_data->>'objetivo',''), nullif(p_data->>'owner',''),
      nullif(p_data->>'location',''), nullif(p_data->>'duration_min','')::int,
      nullif(p_data->>'kickoff',''),
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
      location = nullif(p_data->>'location',''),
      duration_min = nullif(p_data->>'duration_min','')::int,
      kickoff = nullif(p_data->>'kickoff',''),
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

  return v_id;
end; $$;
revoke all on function public.save_meeting_series(jsonb) from public, anon;
grant execute on function public.save_meeting_series(jsonb) to authenticated;

notify pgrst, 'reload schema';

