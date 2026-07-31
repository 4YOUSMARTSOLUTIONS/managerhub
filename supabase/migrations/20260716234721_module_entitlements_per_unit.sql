-- ============ Entitlements de módulos por unidade (SaaS) ============
-- Escrita restrita ao super admin (platform_admins, via is_super_admin()).

create table if not exists public.unit_modules (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  module_key text not null,
  enabled boolean not null default false,
  showcase boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (unit_id, module_key)
);
create index if not exists unit_modules_tenant_idx on public.unit_modules(tenant_id);
alter table public.unit_modules enable row level security;

drop policy if exists unit_modules_select on public.unit_modules;
create policy unit_modules_select on public.unit_modules
  for select using (public.is_tenant_member(tenant_id));
drop policy if exists unit_modules_admin on public.unit_modules;
create policy unit_modules_admin on public.unit_modules
  for all using (public.is_super_admin()) with check (public.is_super_admin());

-- flag global de "em construção" (vale para todas as unidades)
create table if not exists public.platform_module_flags (
  module_key text primary key,
  under_construction boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.platform_module_flags enable row level security;

drop policy if exists platform_module_flags_select on public.platform_module_flags;
create policy platform_module_flags_select on public.platform_module_flags
  for select using (auth.uid() is not null);
drop policy if exists platform_module_flags_admin on public.platform_module_flags;
create policy platform_module_flags_admin on public.platform_module_flags
  for all using (public.is_super_admin()) with check (public.is_super_admin());

-- cliques de "Tenho interesse" (dado comercial: só o super admin lê)
create table if not exists public.module_interest (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  module_key text not null,
  user_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists module_interest_tenant_idx on public.module_interest(tenant_id);
alter table public.module_interest enable row level security;

drop policy if exists module_interest_insert on public.module_interest;
create policy module_interest_insert on public.module_interest
  for insert with check (public.is_tenant_member(tenant_id));
drop policy if exists module_interest_admin on public.module_interest;
create policy module_interest_admin on public.module_interest
  for all using (public.is_super_admin()) with check (public.is_super_admin());

-- ============ SEED: unidades existentes recebem todos os módulos ============
-- Padrão é bloqueado; sem este seed o cliente atual perderia o sistema.
insert into public.unit_modules (tenant_id, unit_id, module_key, enabled, showcase)
select u.tenant_id, u.id, k, true, false
from public.units u
cross join unnest(array[
  'reunioes','acoes','salas',
  'agenda_diario','agendas','agenda_equipe','agenda_historico','tempos_movimentos',
  'chamados',
  'metas','feedbacks','treinamentos',
  'gapa','gop','dto','relatos_anomalia','checklists','formularios',
  'pnr','sustentabilidade','central_sdpo',
  'portaria','multas_avarias',
  'seg_piramide','seg_acidentes','seg_relatos','seg_epis'
]) as k
on conflict (unit_id, module_key) do nothing;

-- ============ RPCs (super admin) ============
create or replace function public.platform_unit_modules(p_tenant uuid)
 returns table (unit_id uuid, module_key text, enabled boolean, showcase boolean)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then raise exception 'Apenas o super admin pode ver os módulos.'; end if;
  return query
    select m.unit_id, m.module_key, m.enabled, m.showcase
    from public.unit_modules m
    join public.units u on u.id = m.unit_id
    where u.tenant_id = p_tenant;
end; $function$;

create or replace function public.platform_set_unit_module(p_unit uuid, p_module text, p_enabled boolean, p_showcase boolean)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_tenant uuid;
begin
  if not public.is_super_admin() then raise exception 'Apenas o super admin pode alterar módulos.'; end if;
  select tenant_id into v_tenant from public.units where id = p_unit;
  if v_tenant is null then raise exception 'Unidade não encontrada.'; end if;
  insert into public.unit_modules (tenant_id, unit_id, module_key, enabled, showcase, updated_at)
  values (v_tenant, p_unit, p_module, coalesce(p_enabled,false), coalesce(p_showcase,false), now())
  on conflict (unit_id, module_key) do update
    set enabled = excluded.enabled, showcase = excluded.showcase, updated_at = now();
end; $function$;

create or replace function public.platform_set_unit_modules_bulk(p_unit uuid, p_modules text[], p_enabled boolean, p_showcase boolean)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_tenant uuid;
begin
  if not public.is_super_admin() then raise exception 'Apenas o super admin pode alterar módulos.'; end if;
  select tenant_id into v_tenant from public.units where id = p_unit;
  if v_tenant is null then raise exception 'Unidade não encontrada.'; end if;
  insert into public.unit_modules (tenant_id, unit_id, module_key, enabled, showcase, updated_at)
  select v_tenant, p_unit, k, coalesce(p_enabled,false), coalesce(p_showcase,false), now()
  from unnest(p_modules) k
  on conflict (unit_id, module_key) do update
    set enabled = excluded.enabled, showcase = excluded.showcase, updated_at = now();
end; $function$;

create or replace function public.platform_set_module_construction(p_module text, p_under boolean)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then raise exception 'Apenas o super admin pode alterar isso.'; end if;
  insert into public.platform_module_flags (module_key, under_construction, updated_at)
  values (p_module, coalesce(p_under,false), now())
  on conflict (module_key) do update
    set under_construction = excluded.under_construction, updated_at = now();
end; $function$;

create or replace function public.platform_module_interest()
 returns table (tenant_id uuid, tenant_name text, unit_id uuid, unit_name text, module_key text, hits bigint, last_at timestamptz)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then raise exception 'Apenas o super admin pode ver os interesses.'; end if;
  return query
    select i.tenant_id, t.name, i.unit_id, u.name, i.module_key, count(*)::bigint, max(i.created_at)
    from public.module_interest i
    join public.tenants t on t.id = i.tenant_id
    left join public.units u on u.id = i.unit_id
    group by i.tenant_id, t.name, i.unit_id, u.name, i.module_key
    order by count(*) desc, max(i.created_at) desc;
end; $function$;

-- tenant-side: registra o interesse do próprio usuário
create or replace function public.register_module_interest(p_module text, p_unit uuid default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_tenant uuid; v_uid uuid := auth.uid(); v_unit uuid := p_unit;
begin
  if v_uid is null then raise exception 'Sessão expirada.'; end if;
  select m.tenant_id into v_tenant from public.memberships m
   where m.user_id = v_uid and m.is_active order by m.created_at limit 1;
  if v_tenant is null then raise exception 'Sem empresa ativa.'; end if;
  if v_unit is not null and not exists (select 1 from public.units where id = v_unit and tenant_id = v_tenant) then
    v_unit := null;
  end if;
  insert into public.module_interest (tenant_id, unit_id, module_key, user_id)
  values (v_tenant, v_unit, p_module, v_uid);
end; $function$;
