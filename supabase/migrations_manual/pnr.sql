-- PNR — Programa Nacional de Revendas: estrutura básica
-- Aplicar no SQL editor do Supabase (ou via MCP apply_migration quando reconectar).
-- Reutiliza os enums existentes goal_direction e area_consolidation.

-- ---------- categorias (seções) ----------
create table if not exists public.pnr_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  sort integer not null default 0,
  max_points numeric,
  created_at timestamptz not null default now()
);

-- ---------- indicadores (KPIs) ----------
create table if not exists public.pnr_kpis (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid references public.pnr_categories(id) on delete set null,
  sort integer not null default 0,
  name text not null,
  owner_id uuid references public.profiles(id),
  unit text not null default '',
  direction public.goal_direction not null default 'maior_melhor',
  consolidation public.area_consolidation not null default 'soma',
  max_points numeric not null default 0,
  target numeric,
  partial_high numeric,
  partial_low numeric,
  points_high numeric,
  points_low numeric,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- apuração mensal ----------
create table if not exists public.pnr_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kpi_id uuid not null references public.pnr_kpis(id) on delete cascade,
  period date not null,
  actual_value numeric,
  numerator_value numeric,
  denominator_value numeric,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists pnr_entries_kpi_period_uniq on public.pnr_entries (kpi_id, period);

-- ---------- RLS ----------
alter table public.pnr_categories enable row level security;
alter table public.pnr_kpis enable row level security;
alter table public.pnr_entries enable row level security;

-- categorias: leitura p/ membros; escrita só owner/admin
create policy pnr_categories_select on public.pnr_categories
  for select using (public.is_tenant_member(tenant_id));
create policy pnr_categories_write on public.pnr_categories
  for all using (public.is_tenant_member(tenant_id) and public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]))
  with check (public.is_tenant_member(tenant_id) and public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]));

-- KPIs: leitura p/ membros; escrita só owner/admin
create policy pnr_kpis_select on public.pnr_kpis
  for select using (public.is_tenant_member(tenant_id));
create policy pnr_kpis_write on public.pnr_kpis
  for all using (public.is_tenant_member(tenant_id) and public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]))
  with check (public.is_tenant_member(tenant_id) and public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]));

-- apuração: leitura p/ membros; escrita se owner/admin OU responsável do KPI
create policy pnr_entries_select on public.pnr_entries
  for select using (public.is_tenant_member(tenant_id));
create policy pnr_entries_write on public.pnr_entries
  for all using (
    public.is_tenant_member(tenant_id) and (
      public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
      or exists (select 1 from public.pnr_kpis k where k.id = pnr_entries.kpi_id and k.owner_id = auth.uid())
    )
  )
  with check (
    public.is_tenant_member(tenant_id) and (
      public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
      or exists (select 1 from public.pnr_kpis k where k.id = pnr_entries.kpi_id and k.owner_id = auth.uid())
    )
  );
