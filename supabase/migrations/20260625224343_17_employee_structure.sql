
-- =============================================================
-- MANAGERHUB · Migration 17 · Estrutura de funcionários e unidades
-- =============================================================

create type unit_kind   as enum ('matriz', 'filial');
create type gender_type as enum ('masculino', 'feminino', 'outro', 'nao_informado');

-- ---------- Unidades (matriz/filial) ----------
create table public.units (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  kind       unit_kind not null default 'filial',
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index idx_units_tenant on public.units(tenant_id);

-- ---------- Setores ----------
create table public.departments (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index idx_departments_tenant on public.departments(tenant_id);

-- ---------- Subsetores (pertencem a um setor) ----------
create table public.subdepartments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  name          text not null,
  created_at    timestamptz not null default now(),
  unique (department_id, name)
);
create index idx_subdepartments_dept on public.subdepartments(department_id);
create index idx_subdepartments_tenant on public.subdepartments(tenant_id);

-- ---------- Funções ----------
create table public.positions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index idx_positions_tenant on public.positions(tenant_id);

-- ---------- Perfis de função (Jr/Pleno/Sênior...) ----------
create table public.position_levels (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index idx_position_levels_tenant on public.position_levels(tenant_id);

-- ---------- Pessoa (perfil) ----------
alter table public.profiles add column if not exists cpf text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists birth_date date;
alter table public.profiles add column if not exists gender gender_type;
alter table public.profiles drop constraint if exists profiles_cpf_format;
alter table public.profiles add constraint profiles_cpf_format check (cpf is null or cpf ~ '^[0-9]{11}$');
create unique index if not exists profiles_cpf_key on public.profiles(cpf) where cpf is not null;

-- ---------- Vínculo / emprego (na empresa) ----------
alter table public.memberships add column if not exists employee_code text;
alter table public.memberships add column if not exists admission_date date;
alter table public.memberships add column if not exists department_id uuid references public.departments(id) on delete set null;
alter table public.memberships add column if not exists subdepartment_id uuid references public.subdepartments(id) on delete set null;
alter table public.memberships add column if not exists position_id uuid references public.positions(id) on delete set null;
alter table public.memberships add column if not exists position_level_id uuid references public.position_levels(id) on delete set null;
alter table public.memberships add column if not exists manager_id uuid references public.profiles(id) on delete set null;
create unique index if not exists memberships_emp_code_key on public.memberships(tenant_id, employee_code) where employee_code is not null;

-- ---------- Unidades de acesso do usuário (N:N) ----------
create table public.membership_units (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  unit_id       uuid not null references public.units(id) on delete cascade,
  primary key (membership_id, unit_id)
);
create index idx_membership_units_unit on public.membership_units(unit_id);

-- ---------- RLS ----------
alter table public.units            enable row level security;
alter table public.departments      enable row level security;
alter table public.subdepartments   enable row level security;
alter table public.positions        enable row level security;
alter table public.position_levels  enable row level security;
alter table public.membership_units enable row level security;

-- registries: membros leem; owner/admin escrevem
do $$
declare t text;
begin
  foreach t in array array['units','departments','subdepartments','positions','position_levels']
  loop
    execute format('create policy %I on public.%I for select using (public.is_tenant_member(tenant_id));', t||'_select', t);
    execute format('create policy %I on public.%I for all using (public.has_tenant_role(tenant_id, array[''owner'',''admin'']::member_role[])) with check (public.has_tenant_role(tenant_id, array[''owner'',''admin'']::member_role[]));', t||'_write', t);
  end loop;
end $$;

-- membership_units: visível a membros do tenant; escrita por owner/admin
create policy "membership_units_select" on public.membership_units
  for select using (
    exists (select 1 from public.memberships m where m.id = membership_id and public.is_tenant_member(m.tenant_id))
  );
create policy "membership_units_write" on public.membership_units
  for all using (
    exists (select 1 from public.memberships m where m.id = membership_id and public.has_tenant_role(m.tenant_id, array['owner','admin']::member_role[]))
  ) with check (
    exists (select 1 from public.memberships m where m.id = membership_id and public.has_tenant_role(m.tenant_id, array['owner','admin']::member_role[]))
  );

notify pgrst, 'reload schema';

