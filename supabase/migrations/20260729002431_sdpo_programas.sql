-- Programa do Programa de Excelência (ex.: SPO, DPO). Cada Pilar pertence a um Programa.
create table if not exists public.sdpo_programas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.sdpo_programas enable row level security;

drop policy if exists sdpo_programas_rw on public.sdpo_programas;
create policy sdpo_programas_rw on public.sdpo_programas
  for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

create index if not exists sdpo_programas_tenant_idx on public.sdpo_programas(tenant_id);

-- Vínculo Pilar -> Programa (nullable; sem dados a migrar no momento)
alter table public.sdpo_pilares
  add column if not exists programa_id uuid references public.sdpo_programas(id) on delete restrict;

create index if not exists sdpo_pilares_programa_idx on public.sdpo_pilares(programa_id);
