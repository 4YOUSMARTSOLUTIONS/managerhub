create table public.sustainability_kpis (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sort integer not null default 0,
  name text not null,
  owner_id uuid references public.profiles(id),
  unit text not null default '',
  direction public.goal_direction not null default 'maior_melhor',
  consolidation public.area_consolidation not null default 'soma',
  target numeric,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sustainability_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kpi_id uuid not null references public.sustainability_kpis(id) on delete cascade,
  period date not null,
  actual_value numeric,
  numerator_value numeric,
  denominator_value numeric,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index sustainability_entries_kpi_period_uniq on public.sustainability_entries (kpi_id, period);

alter table public.sustainability_kpis enable row level security;
alter table public.sustainability_entries enable row level security;

create policy sust_kpis_select on public.sustainability_kpis
  for select using (public.is_tenant_member(tenant_id));
create policy sust_kpis_write on public.sustainability_kpis
  for all using (public.is_tenant_member(tenant_id) and public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]))
  with check (public.is_tenant_member(tenant_id) and public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]));

create policy sust_entries_select on public.sustainability_entries
  for select using (public.is_tenant_member(tenant_id));
create policy sust_entries_write on public.sustainability_entries
  for all using (
    public.is_tenant_member(tenant_id) and (
      public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
      or exists (select 1 from public.sustainability_kpis k where k.id = sustainability_entries.kpi_id and k.owner_id = auth.uid())
    )
  )
  with check (
    public.is_tenant_member(tenant_id) and (
      public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
      or exists (select 1 from public.sustainability_kpis k where k.id = sustainability_entries.kpi_id and k.owner_id = auth.uid())
    )
  );
