-- Direção do indicador
create type goal_direction as enum ('maior_melhor', 'menor_melhor');

-- Meta individual (definição)
create table public.individual_goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  unit text not null default '',
  direction goal_direction not null default 'maior_melhor',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index individual_goals_tenant_idx on public.individual_goals(tenant_id);
create index individual_goals_owner_idx on public.individual_goals(owner_id);
alter table public.individual_goals enable row level security;
create policy individual_goals_rw on public.individual_goals
  for all
  using (is_tenant_member(tenant_id) and (owner_id = auth.uid() or has_tenant_role(tenant_id, '{owner,admin}')))
  with check (is_tenant_member(tenant_id) and (owner_id = auth.uid() or has_tenant_role(tenant_id, '{owner,admin}')));
create trigger trg_individual_goals_updated before update on public.individual_goals
  for each row execute function set_updated_at();

-- Registro por competência (mês): meta + realizado
create table public.individual_goal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  goal_id uuid not null references public.individual_goals(id) on delete cascade,
  period date not null,
  target_value numeric not null,
  actual_value numeric,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (goal_id, period)
);
create index individual_goal_entries_tenant_idx on public.individual_goal_entries(tenant_id);
create index individual_goal_entries_goal_idx on public.individual_goal_entries(goal_id);
alter table public.individual_goal_entries enable row level security;
create policy individual_goal_entries_rw on public.individual_goal_entries
  for all
  using (is_tenant_member(tenant_id) and exists (
    select 1 from public.individual_goals g
    where g.id = goal_id and (g.owner_id = auth.uid() or has_tenant_role(g.tenant_id, '{owner,admin}'))
  ))
  with check (is_tenant_member(tenant_id) and exists (
    select 1 from public.individual_goals g
    where g.id = goal_id and (g.owner_id = auth.uid() or has_tenant_role(g.tenant_id, '{owner,admin}'))
  ));
create trigger trg_individual_goal_entries_updated before update on public.individual_goal_entries
  for each row execute function set_updated_at();

notify pgrst, 'reload schema';
