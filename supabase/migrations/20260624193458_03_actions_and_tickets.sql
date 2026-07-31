
-- =============================================================
-- MANAGERHUB · Migration 03 · Ações e Chamados
-- =============================================================
create type priority_level   as enum ('low', 'medium', 'high', 'urgent');
create type action_status    as enum ('open', 'in_progress', 'blocked', 'done', 'cancelled');
create type ticket_status    as enum ('open', 'in_progress', 'waiting', 'resolved', 'closed', 'cancelled');
create type ticket_category  as enum ('ti', 'servicos_gerais', 'facilities', 'rh', 'financeiro', 'outros');

-- ---------- Ações abertas em reuniões ----------
create table public.action_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  meeting_id   uuid references public.meetings(id) on delete set null,
  title        text not null,
  description  text,
  assignee_id  uuid references public.profiles(id) on delete set null,
  priority     priority_level not null default 'medium',
  status       action_status  not null default 'open',
  due_date     date,
  completed_at timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_actions_tenant on public.action_items(tenant_id);
create index idx_actions_assignee on public.action_items(assignee_id);
create index idx_actions_meeting on public.action_items(meeting_id);
create index idx_actions_due on public.action_items(due_date);
create trigger trg_actions_updated before update on public.action_items
  for each row execute function public.set_updated_at();

-- ---------- Chamados (TI / Serviços Gerais) ----------
create sequence if not exists public.ticket_code_seq;

create table public.tickets (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  code         text unique,
  category     ticket_category not null default 'outros',
  title        text not null,
  description  text,
  requester_id uuid references public.profiles(id) on delete set null,
  assignee_id  uuid references public.profiles(id) on delete set null,
  priority     priority_level not null default 'medium',
  status       ticket_status   not null default 'open',
  due_date     date,
  resolved_at  timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_tickets_tenant on public.tickets(tenant_id);
create index idx_tickets_assignee on public.tickets(assignee_id);
create index idx_tickets_status on public.tickets(status);

-- gera código CH-0001 e marca resolved_at
create or replace function public.tickets_before_insert()
returns trigger language plpgsql as $$
begin
  if new.code is null then
    new.code := 'CH-' || lpad(nextval('public.ticket_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;
create trigger trg_tickets_code before insert on public.tickets
  for each row execute function public.tickets_before_insert();
create trigger trg_tickets_updated before update on public.tickets
  for each row execute function public.set_updated_at();

-- ---------- Comentários de chamados ----------
create table public.ticket_comments (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.tickets(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index idx_ticket_comments_ticket on public.ticket_comments(ticket_id);

-- ---------- RLS ----------
alter table public.action_items   enable row level security;
alter table public.tickets        enable row level security;
alter table public.ticket_comments enable row level security;

create policy "actions_member_select" on public.action_items
  for select using (public.is_tenant_member(tenant_id));
create policy "actions_member_write" on public.action_items
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

create policy "tickets_member_select" on public.tickets
  for select using (public.is_tenant_member(tenant_id));
create policy "tickets_member_write" on public.tickets
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

create policy "ticket_comments_member_select" on public.ticket_comments
  for select using (
    exists (select 1 from public.tickets t
            where t.id = ticket_id and public.is_tenant_member(t.tenant_id))
  );
create policy "ticket_comments_member_write" on public.ticket_comments
  for all using (
    exists (select 1 from public.tickets t
            where t.id = ticket_id and public.is_tenant_member(t.tenant_id))
  ) with check (
    exists (select 1 from public.tickets t
            where t.id = ticket_id and public.is_tenant_member(t.tenant_id))
  );

