create type area_goal_kind as enum ('ic', 'iv');
create type area_consolidation as enum ('soma', 'media', 'manual');

-- Indicador da área
create table public.area_goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  name text not null,
  unit text not null default '',
  kind area_goal_kind not null default 'ic',
  direction goal_direction not null default 'maior_melhor',
  consolidation area_consolidation not null default 'soma',
  owner_id uuid references public.profiles(id) on delete set null,
  sort integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index area_goals_tenant_idx on public.area_goals(tenant_id);
create index area_goals_department_idx on public.area_goals(department_id);
alter table public.area_goals enable row level security;
create policy area_goals_select on public.area_goals
  for select using (is_tenant_member(tenant_id));
create policy area_goals_write on public.area_goals
  for all
  using (has_tenant_role(tenant_id, '{owner,admin}'))
  with check (has_tenant_role(tenant_id, '{owner,admin}'));
create trigger trg_area_goals_updated before update on public.area_goals
  for each row execute function set_updated_at();

-- Registro por unidade × competência (mês). unit_id NULL = Grupo (consolidação manual)
create table public.area_goal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  area_goal_id uuid not null references public.area_goals(id) on delete cascade,
  unit_id uuid references public.units(id) on delete cascade,
  period date not null,
  target_value numeric,
  actual_value numeric,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index area_goal_entries_unit_uk on public.area_goal_entries (area_goal_id, period, unit_id) where unit_id is not null;
create unique index area_goal_entries_grp_uk on public.area_goal_entries (area_goal_id, period) where unit_id is null;
create index area_goal_entries_tenant_idx on public.area_goal_entries(tenant_id);
create index area_goal_entries_goal_idx on public.area_goal_entries(area_goal_id);
alter table public.area_goal_entries enable row level security;
create policy area_goal_entries_select on public.area_goal_entries
  for select using (is_tenant_member(tenant_id));
create policy area_goal_entries_write on public.area_goal_entries
  for all
  using (is_tenant_member(tenant_id) and (has_tenant_role(tenant_id, '{owner,admin}') or exists (
    select 1 from public.area_goals g where g.id = area_goal_id and g.owner_id = auth.uid()
  )))
  with check (is_tenant_member(tenant_id) and (has_tenant_role(tenant_id, '{owner,admin}') or exists (
    select 1 from public.area_goals g where g.id = area_goal_id and g.owner_id = auth.uid()
  )));
create trigger trg_area_goal_entries_updated before update on public.area_goal_entries
  for each row execute function set_updated_at();

notify pgrst, 'reload schema';
