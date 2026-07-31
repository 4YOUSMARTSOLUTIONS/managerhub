
-- Prazo por demanda + prioridade na ação
alter table public.action_demandas add column if not exists due_date date;
alter table public.actions add column if not exists priority public.priority_level not null default 'medium';

-- Pedidos (prorrogação de prazo / conclusão) que dependem de aprovação do solicitante
create table if not exists public.demanda_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  demanda_id uuid not null references public.action_demandas(id) on delete cascade,
  type text not null check (type in ('prazo','conclusao')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid references public.profiles(id),
  new_due_date date,
  note text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index if not exists demanda_requests_demanda_idx on public.demanda_requests(demanda_id);
-- no máximo 1 pedido pendente por tipo/demanda
create unique index if not exists demanda_requests_one_pending
  on public.demanda_requests(demanda_id, type) where status = 'pending';

-- Histórico/auditoria (inclui comentários) por demanda
create table if not exists public.demanda_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  demanda_id uuid not null references public.action_demandas(id) on delete cascade,
  type text not null,
  actor_id uuid references public.profiles(id),
  body text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists demanda_events_demanda_idx on public.demanda_events(demanda_id, created_at);

-- Notificações in-app
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  demanda_id uuid references public.action_demandas(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_unread_idx on public.notifications(user_id) where is_read = false;

-- RLS
alter table public.demanda_requests enable row level security;
alter table public.demanda_events enable row level security;
alter table public.notifications enable row level security;

drop policy if exists demanda_requests_rw on public.demanda_requests;
create policy demanda_requests_rw on public.demanda_requests for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

drop policy if exists demanda_events_rw on public.demanda_events;
create policy demanda_events_rw on public.demanda_events for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

drop policy if exists notifications_own_select on public.notifications;
create policy notifications_own_select on public.notifications for select using (user_id = auth.uid());
drop policy if exists notifications_own_update on public.notifications;
create policy notifications_own_update on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.demanda_requests, public.demanda_events to authenticated;
grant select, update on public.notifications to authenticated;

notify pgrst, 'reload schema';

