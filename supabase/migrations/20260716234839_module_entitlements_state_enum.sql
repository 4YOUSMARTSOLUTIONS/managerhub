-- Estado único em vez de 2 booleanos (enabled+showcase criava estado impossível)
do $$ begin
  create type public.unit_module_state as enum ('on','locked','hidden');
exception when duplicate_object then null; end $$;

alter table public.unit_modules add column if not exists state public.unit_module_state;
update public.unit_modules
   set state = (case when enabled then 'on' when showcase then 'locked' else 'hidden' end)::public.unit_module_state
 where state is null;
alter table public.unit_modules alter column state set default 'hidden';
alter table public.unit_modules alter column state set not null;
alter table public.unit_modules drop column if exists enabled;
alter table public.unit_modules drop column if exists showcase;
alter table public.unit_modules add column if not exists updated_by uuid;

-- interesse: 1 linha por (unidade, módulo, usuário) com contador, em vez de append-only
drop table if exists public.module_interest;
create table public.module_interest (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  module_key text not null,
  user_id uuid not null,
  hits integer not null default 1,
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  unique (unit_id, module_key, user_id)
);
create index module_interest_module_idx on public.module_interest(module_key);
alter table public.module_interest enable row level security;
create policy module_interest_admin on public.module_interest
  for all using (public.is_super_admin()) with check (public.is_super_admin());

-- flags: só o super admin marca "em construção" (global)
insert into public.platform_module_flags (module_key, under_construction)
values
  ('gapa',true),('gop',true),('dto',true),('relatos_anomalia',true),('formularios',true),
  ('treinamentos',true),('portaria',true),('multas_avarias',true),
  ('seg_piramide',true),('seg_acidentes',true),('seg_relatos',true),('seg_epis',true)
on conflict (module_key) do nothing;

-- ============ RPCs (recriadas para o enum) ============
drop function if exists public.platform_unit_modules(uuid);
drop function if exists public.platform_set_unit_module(uuid, text, boolean, boolean);
drop function if exists public.platform_set_unit_modules_bulk(uuid, text[], boolean, boolean);
drop function if exists public.platform_module_interest();
drop function if exists public.register_module_interest(text, uuid);

create or replace function public.platform_module_matrix(p_tenant uuid)
 returns table (unit_id uuid, unit_name text, module_key text, state public.unit_module_state)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then raise exception 'Apenas o super admin.'; end if;
  return query
    select u.id, u.name, um.module_key, um.state
      from public.units u
      left join public.unit_modules um on um.unit_id = u.id
     where u.tenant_id = p_tenant
     order by u.name, um.module_key;
end $function$;

-- bulk é o caso geral: "setar um" = array de 1 elemento
create or replace function public.platform_set_unit_modules(p_unit uuid, p_modules text[], p_state public.unit_module_state)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_tenant uuid;
begin
  if not public.is_super_admin() then raise exception 'Apenas o super admin.'; end if;
  select tenant_id into v_tenant from public.units where id = p_unit;
  if v_tenant is null then raise exception 'Unidade não encontrada.'; end if;
  insert into public.unit_modules (tenant_id, unit_id, module_key, state, updated_by, updated_at)
  select v_tenant, p_unit, k, p_state, auth.uid(), now() from unnest(p_modules) k
  on conflict (unit_id, module_key) do update
    set state = excluded.state, updated_by = auth.uid(), updated_at = now();
end $function$;

-- aplica a todas as unidades da empresa (a venda costuma ser por empresa)
create or replace function public.platform_set_tenant_modules(p_tenant uuid, p_modules text[], p_state public.unit_module_state)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then raise exception 'Apenas o super admin.'; end if;
  insert into public.unit_modules (tenant_id, unit_id, module_key, state, updated_by, updated_at)
  select p_tenant, u.id, k, p_state, auth.uid(), now()
    from public.units u cross join unnest(p_modules) k
   where u.tenant_id = p_tenant
  on conflict (unit_id, module_key) do update
    set state = excluded.state, updated_by = auth.uid(), updated_at = now();
end $function$;

create or replace function public.platform_module_interest()
 returns table (module_key text, tenant_id uuid, tenant_name text, unit_id uuid, unit_name text,
                users_count integer, hits integer, last_at timestamptz)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then raise exception 'Apenas o super admin.'; end if;
  return query
    select mi.module_key, t.id, t.name, u.id, u.name,
           count(*)::integer, sum(mi.hits)::integer, max(mi.last_at)
      from public.module_interest mi
      join public.tenants t on t.id = mi.tenant_id
      join public.units u on u.id = mi.unit_id
     group by mi.module_key, t.id, t.name, u.id, u.name
     order by sum(mi.hits) desc, max(mi.last_at) desc;
end $function$;

-- tenant-side: só registra onde o módulo está REALMENTE 'locked' e o usuário é membro
create or replace function public.register_module_interest(p_units uuid[], p_module text)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'Sessão expirada.'; end if;
  with target as (
    select um.tenant_id, um.unit_id
      from public.unit_modules um
     where um.unit_id = any(p_units) and um.module_key = p_module
       and um.state = 'locked' and public.is_tenant_member(um.tenant_id)
  ), ins as (
    insert into public.module_interest (tenant_id, unit_id, module_key, user_id)
    select t.tenant_id, t.unit_id, p_module, auth.uid() from target t
    on conflict (unit_id, module_key, user_id)
      do update set hits = public.module_interest.hits + 1, last_at = now()
    returning 1
  )
  select count(*)::integer into v_count from ins;
  return v_count;
end $function$;
