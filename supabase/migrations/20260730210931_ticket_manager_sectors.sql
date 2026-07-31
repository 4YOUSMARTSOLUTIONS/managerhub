-- Setores que cada gestor de chamados atende (escopo de acesso)
create table if not exists public.ticket_manager_sectors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sector_id uuid not null references public.ticket_sectors(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id, sector_id)
);
alter table public.ticket_manager_sectors enable row level security;
drop policy if exists ticket_manager_sectors_rw on public.ticket_manager_sectors;
create policy ticket_manager_sectors_rw on public.ticket_manager_sectors
  for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
create index if not exists tms_tenant_user_idx on public.ticket_manager_sectors(tenant_id, user_id);
create index if not exists tms_sector_idx on public.ticket_manager_sectors(sector_id);
