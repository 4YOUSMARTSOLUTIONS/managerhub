-- O relato passa a gravar a ocorrência padronizada.
--
-- As duas RPCs (criar e editar) ganham o mesmo parâmetro e a mesma validação:
-- ocorrência de outra empresa vira nulo em silêncio, como os demais catálogos.
-- A coerência entre ocorrência e classificação NÃO é imposta aqui de propósito:
-- a tela já só oferece o que combina, e travar no banco quebraria o caso real
-- de a equipe reclassificar um relato depois (o rótulo do fato continua certo,
-- o que mudou foi a leitura dele).

create or replace function public.seg_criar_relato(p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant     uuid := public.my_active_tenant();
  v_id         uuid;
  v_tipo       record;
  v_ocorrido   date;
  v_descricao  text;
  v_unit       uuid;
  v_local      uuid;
  v_area       uuid;
  v_ocorrencia uuid;
  v_envolvidos uuid[];
  v_avisar     uuid[];
begin
  if v_tenant is null or not public.is_tenant_member(v_tenant) then
    raise exception 'Você não tem acesso a esta empresa.';
  end if;

  v_ocorrido   := nullif(p_data->>'occurred_on', '')::date;
  v_descricao  := btrim(coalesce(p_data->>'descricao', ''));
  v_local      := nullif(p_data->>'local_id', '')::uuid;
  v_area       := nullif(p_data->>'area_id', '')::uuid;
  v_ocorrencia := nullif(p_data->>'ocorrencia_id', '')::uuid;

  if v_ocorrido is null then
    raise exception 'Informe a data do ocorrido.';
  end if;
  if v_ocorrido > current_date then
    raise exception 'A data do ocorrido não pode estar no futuro.';
  end if;
  if v_descricao = '' then
    raise exception 'Descreva o que aconteceu.';
  end if;

  select t.id, t.name, t.natureza into v_tipo
    from public.seg_tipos_relato t
   where t.id = nullif(p_data->>'tipo_id', '')::uuid
     and t.tenant_id = v_tenant
     and t.active;
  if v_tipo.id is null then
    raise exception 'Escolha um tipo de relato válido.';
  end if;

  if v_local is not null and not exists (
    select 1 from public.seg_locais l where l.id = v_local and l.tenant_id = v_tenant
  ) then
    v_local := null;
  end if;
  if v_area is not null and not exists (
    select 1 from public.seg_areas a where a.id = v_area and a.tenant_id = v_tenant
  ) then
    v_area := null;
  end if;
  if v_ocorrencia is not null and not exists (
    select 1 from public.seg_ocorrencias o where o.id = v_ocorrencia and o.tenant_id = v_tenant
  ) then
    v_ocorrencia := null;
  end if;

  select array_agg(distinct e.uid) into v_envolvidos
    from jsonb_array_elements_text(coalesce(p_data->'envolvidos', '[]'::jsonb)) as x(uid)
    cross join lateral (select x.uid::uuid as uid) e
   where exists (
     select 1 from public.memberships m
      where m.user_id = e.uid and m.tenant_id = v_tenant and m.is_active
   );

  select u.id into v_unit
    from public.memberships m
    join public.membership_units mu on mu.membership_id = m.id
    join public.units u on u.id = mu.unit_id
   where m.tenant_id = v_tenant
     and m.user_id = coalesce(v_envolvidos[1], (select auth.uid()))
   order by u.name
   limit 1;

  insert into public.seg_relatos (
    tenant_id, unit_id, occurred_on, tipo_id, snap_natureza,
    local_id, area_id, ocorrencia_id, descricao, created_by
  ) values (
    v_tenant, v_unit, v_ocorrido, v_tipo.id, v_tipo.natureza,
    v_local, v_area, v_ocorrencia, v_descricao, (select auth.uid())
  )
  returning id into v_id;

  if v_envolvidos is not null then
    insert into public.seg_relato_envolvidos (relato_id, tenant_id, user_id)
    select v_id, v_tenant, u from unnest(v_envolvidos) as u;
  end if;

  select array_agg(distinct uid) into v_avisar from (
    select e.user_id as uid from public.seg_equipe e where e.tenant_id = v_tenant
    union
    select m.user_id from public.memberships m
     where m.tenant_id = v_tenant and m.role in ('owner', 'admin') and m.is_active
  ) todos;

  if v_avisar is not null then
    perform public.notify_users(
      v_tenant, v_avisar, 'seg_relato_novo',
      'Novo relato de segurança',
      v_tipo.name || ' em ' || to_char(v_ocorrido, 'DD/MM/YYYY') || '. Abra a fila para triar.',
      null
    );
  end if;

  return v_id;
end;
$$;

revoke execute on function public.seg_criar_relato(jsonb) from public, anon;
grant  execute on function public.seg_criar_relato(jsonb) to authenticated;

create or replace function public.seg_editar_relato(p_id uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_r          record;
  v_tipo       record;
  v_ocorrido   date;
  v_descricao  text;
  v_local      uuid;
  v_area       uuid;
  v_ocorrencia uuid;
  v_unit       uuid;
  v_envolvidos uuid[];
begin
  select r.* into v_r from public.seg_relatos r where r.id = p_id;
  if v_r.id is null then
    raise exception 'Relato não encontrado.';
  end if;
  if v_r.created_by <> (select auth.uid()) then
    raise exception 'Só quem registrou o relato pode editá-lo.';
  end if;
  if v_r.status <> 'aberto' then
    raise exception 'A equipe de segurança já começou a tratar este relato, então ele não muda mais. Fale com ela se algo estiver errado.';
  end if;

  v_ocorrido   := nullif(p_data->>'occurred_on', '')::date;
  v_descricao  := btrim(coalesce(p_data->>'descricao', ''));
  v_local      := nullif(p_data->>'local_id', '')::uuid;
  v_area       := nullif(p_data->>'area_id', '')::uuid;
  v_ocorrencia := nullif(p_data->>'ocorrencia_id', '')::uuid;

  if v_ocorrido is null then
    raise exception 'Informe a data do ocorrido.';
  end if;
  if v_ocorrido > current_date then
    raise exception 'A data do ocorrido não pode estar no futuro.';
  end if;
  if v_descricao = '' then
    raise exception 'Descreva o que aconteceu.';
  end if;

  select t.id, t.natureza into v_tipo
    from public.seg_tipos_relato t
   where t.id = nullif(p_data->>'tipo_id', '')::uuid
     and t.tenant_id = v_r.tenant_id
     and t.active;
  if v_tipo.id is null then
    raise exception 'Escolha um tipo de relato válido.';
  end if;

  if v_local is not null and not exists (
    select 1 from public.seg_locais l where l.id = v_local and l.tenant_id = v_r.tenant_id
  ) then
    v_local := null;
  end if;
  if v_area is not null and not exists (
    select 1 from public.seg_areas a where a.id = v_area and a.tenant_id = v_r.tenant_id
  ) then
    v_area := null;
  end if;
  if v_ocorrencia is not null and not exists (
    select 1 from public.seg_ocorrencias o where o.id = v_ocorrencia and o.tenant_id = v_r.tenant_id
  ) then
    v_ocorrencia := null;
  end if;

  select array_agg(distinct e.uid) into v_envolvidos
    from jsonb_array_elements_text(coalesce(p_data->'envolvidos', '[]'::jsonb)) as x(uid)
    cross join lateral (select x.uid::uuid as uid) e
   where exists (
     select 1 from public.memberships m
      where m.user_id = e.uid and m.tenant_id = v_r.tenant_id and m.is_active
   );

  select u.id into v_unit
    from public.memberships m
    join public.membership_units mu on mu.membership_id = m.id
    join public.units u on u.id = mu.unit_id
   where m.tenant_id = v_r.tenant_id
     and m.user_id = coalesce(v_envolvidos[1], v_r.created_by)
   order by u.name
   limit 1;

  update public.seg_relatos
     set occurred_on = v_ocorrido,
         tipo_id = v_tipo.id,
         snap_natureza = v_tipo.natureza,
         local_id = v_local,
         area_id = v_area,
         ocorrencia_id = v_ocorrencia,
         unit_id = v_unit,
         descricao = v_descricao
   where id = p_id;

  delete from public.seg_relato_envolvidos where relato_id = p_id;
  if v_envolvidos is not null then
    insert into public.seg_relato_envolvidos (relato_id, tenant_id, user_id)
    select p_id, v_r.tenant_id, u from unnest(v_envolvidos) as u;
  end if;
end;
$$;

revoke execute on function public.seg_editar_relato(uuid, jsonb) from public, anon;
grant  execute on function public.seg_editar_relato(uuid, jsonb) to authenticated;

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception 'ha % funcoes SECURITY DEFINER alcancaveis por anon', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
