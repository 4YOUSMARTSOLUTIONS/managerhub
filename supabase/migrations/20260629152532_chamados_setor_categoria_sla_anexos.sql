-- Enum de unidade de SLA
create type ticket_sla_unit as enum ('horas', 'dias_corridos', 'dias_uteis');

-- Setores de chamado (configuráveis por tenant)
create table public.ticket_sectors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index ticket_sectors_tenant_idx on public.ticket_sectors(tenant_id);
alter table public.ticket_sectors enable row level security;
create policy ticket_sectors_rw on public.ticket_sectors
  for all using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- Categorias de chamado (cada uma pertence a um setor)
create table public.ticket_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sector_id uuid not null references public.ticket_sectors(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index ticket_categories_tenant_idx on public.ticket_categories(tenant_id);
create index ticket_categories_sector_idx on public.ticket_categories(sector_id);
alter table public.ticket_categories enable row level security;
create policy ticket_categories_rw on public.ticket_categories
  for all using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- SLA: matriz categoria x prioridade (valor + unidade)
create table public.ticket_slas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid not null references public.ticket_categories(id) on delete cascade,
  priority priority_level not null,
  sla_value integer not null check (sla_value >= 0),
  sla_unit ticket_sla_unit not null default 'horas',
  created_at timestamptz not null default now(),
  unique (category_id, priority)
);
create index ticket_slas_tenant_idx on public.ticket_slas(tenant_id);
alter table public.ticket_slas enable row level security;
create policy ticket_slas_rw on public.ticket_slas
  for all using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- Anexos (imagens) do chamado — espelha action_attachments
create table public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  path text not null,
  filename text not null,
  size bigint,
  content_type text,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);
create index ticket_attachments_tenant_idx on public.ticket_attachments(tenant_id);
create index ticket_attachments_ticket_idx on public.ticket_attachments(ticket_id);
alter table public.ticket_attachments enable row level security;
create policy ticket_attachments_rw on public.ticket_attachments
  for all using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- Novas colunas em tickets
alter table public.tickets
  add column sector_id uuid references public.ticket_sectors(id) on delete set null,
  add column category_id uuid references public.ticket_categories(id) on delete set null,
  add column unit_id uuid references public.units(id) on delete set null,
  add column requested_priority priority_level;

-- due_date passa a guardar data/hora (SLA pode ser em horas)
alter table public.tickets
  alter column due_date type timestamptz using (case when due_date is null then null else due_date::timestamptz end);

-- categoria legada deixa de ser obrigatória (novo fluxo usa category_id)
alter table public.tickets alter column category drop not null;

-- Bucket privado de anexos de chamado + policies tenant-scoped
insert into storage.buckets (id, name, public) values ('ticket-attachments', 'ticket-attachments', false)
  on conflict (id) do nothing;

create policy ticket_attach_select on storage.objects for select
  using (bucket_id = 'ticket-attachments' and is_tenant_member(((storage.foldername(name))[1])::uuid));
create policy ticket_attach_insert on storage.objects for insert
  with check (bucket_id = 'ticket-attachments' and is_tenant_member(((storage.foldername(name))[1])::uuid));
create policy ticket_attach_delete on storage.objects for delete
  using (bucket_id = 'ticket-attachments' and is_tenant_member(((storage.foldername(name))[1])::uuid));

notify pgrst, 'reload schema';
