
-- Cabeçalho da ação
create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  is_sdpo boolean not null default false,
  pilar_id uuid references public.sdpo_pilares(id) on delete set null,
  bloco_id uuid references public.sdpo_blocos(id) on delete set null,
  item_id uuid references public.sdpo_itens(id) on delete set null,
  meeting_series_id uuid references public.meeting_series(id) on delete set null,
  occurrence_id uuid references public.meeting_occurrences(id) on delete set null,
  kpi_id uuid references public.action_kpis(id) on delete set null,
  tool_id uuid references public.action_tools(id) on delete set null,
  requester_id uuid references public.profiles(id),
  due_date date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Demandas (cada ação tem 1+)
create table if not exists public.action_demandas (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.actions(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  description text not null,
  status public.action_status not null default 'open',
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Responsáveis por demanda (1+)
create table if not exists public.action_demanda_assignees (
  demanda_id uuid not null references public.action_demandas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (demanda_id, user_id)
);

-- Em cópia (cabeçalho)
create table if not exists public.action_cc (
  action_id uuid not null references public.actions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (action_id, user_id)
);

-- Anexos
create table if not exists public.action_attachments (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.actions(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  path text not null,
  filename text not null,
  size bigint,
  content_type text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists actions_tenant_idx on public.actions(tenant_id);
create index if not exists action_demandas_action_idx on public.action_demandas(action_id);
create index if not exists action_demandas_tenant_idx on public.action_demandas(tenant_id);

-- RLS
alter table public.actions enable row level security;
alter table public.action_demandas enable row level security;
alter table public.action_demanda_assignees enable row level security;
alter table public.action_cc enable row level security;
alter table public.action_attachments enable row level security;

drop policy if exists actions_rw on public.actions;
create policy actions_rw on public.actions for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

drop policy if exists action_demandas_rw on public.action_demandas;
create policy action_demandas_rw on public.action_demandas for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

drop policy if exists ada_rw on public.action_demanda_assignees;
create policy ada_rw on public.action_demanda_assignees for all
  using (exists (select 1 from public.action_demandas d where d.id = demanda_id and public.is_tenant_member(d.tenant_id)))
  with check (exists (select 1 from public.action_demandas d where d.id = demanda_id and public.is_tenant_member(d.tenant_id)));

drop policy if exists action_cc_rw on public.action_cc;
create policy action_cc_rw on public.action_cc for all
  using (exists (select 1 from public.actions a where a.id = action_id and public.is_tenant_member(a.tenant_id)))
  with check (exists (select 1 from public.actions a where a.id = action_id and public.is_tenant_member(a.tenant_id)));

drop policy if exists action_attachments_rw on public.action_attachments;
create policy action_attachments_rw on public.action_attachments for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.actions, public.action_demandas, public.action_demanda_assignees, public.action_cc, public.action_attachments to authenticated;

notify pgrst, 'reload schema';

