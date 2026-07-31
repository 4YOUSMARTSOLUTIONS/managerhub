
-- =============================================================
-- MANAGERHUB · Migration 01 · Core tenancy, profiles, RLS base
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------- Enums ----------
create type member_role as enum ('owner', 'admin', 'manager', 'member');

-- ---------- updated_at helper ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- Tenants (empresas) ----------
create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_tenants_updated before update on public.tenants
  for each row execute function public.set_updated_at();

-- ---------- Profiles (espelho de auth.users) ----------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------- Memberships (usuário <-> empresa + papel) ----------
create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        member_role not null default 'member',
  created_at  timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index idx_memberships_user on public.memberships(user_id);
create index idx_memberships_tenant on public.memberships(tenant_id);

-- ---------- Helper: tenants do usuário atual ----------
create or replace function public.current_tenant_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select tenant_id from public.memberships where user_id = auth.uid();
$$;

create or replace function public.is_tenant_member(p_tenant uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.memberships
    where user_id = auth.uid() and tenant_id = p_tenant
  );
$$;

create or replace function public.has_tenant_role(p_tenant uuid, p_roles member_role[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.memberships
    where user_id = auth.uid()
      and tenant_id = p_tenant
      and role = any(p_roles)
  );
$$;

-- ---------- Trigger: cria profile no signup ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- RLS ----------
alter table public.tenants     enable row level security;
alter table public.profiles    enable row level security;
alter table public.memberships enable row level security;

-- profiles: dono lê/edita o próprio; membros do mesmo tenant podem ver perfis
create policy "profiles_self_select" on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1 from public.memberships m1
      join public.memberships m2 on m1.tenant_id = m2.tenant_id
      where m1.user_id = auth.uid() and m2.user_id = profiles.id
    )
  );
create policy "profiles_self_update" on public.profiles
  for update using (id = auth.uid());
create policy "profiles_self_insert" on public.profiles
  for insert with check (id = auth.uid());

-- tenants: membros veem; owner/admin editam
create policy "tenants_member_select" on public.tenants
  for select using (public.is_tenant_member(id));
create policy "tenants_admin_update" on public.tenants
  for update using (public.has_tenant_role(id, array['owner','admin']::member_role[]));
-- qualquer usuário autenticado pode criar empresa (vira owner via app)
create policy "tenants_authenticated_insert" on public.tenants
  for insert with check (auth.uid() is not null);

-- memberships: usuário vê suas memberships e as do mesmo tenant
create policy "memberships_select" on public.memberships
  for select using (
    user_id = auth.uid() or public.is_tenant_member(tenant_id)
  );
create policy "memberships_admin_write" on public.memberships
  for all using (
    public.has_tenant_role(tenant_id, array['owner','admin']::member_role[])
  ) with check (
    public.has_tenant_role(tenant_id, array['owner','admin']::member_role[])
  );
-- permite o próprio usuário criar sua membership inicial (onboarding)
create policy "memberships_self_insert" on public.memberships
  for insert with check (user_id = auth.uid());

