
-- Pré-cadastros do Programa de Excelência (SDPO) — cascata Pilar > Bloco > Item
create table if not exists public.sdpo_pilares (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.sdpo_blocos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pilar_id uuid not null references public.sdpo_pilares(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.sdpo_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bloco_id uuid not null references public.sdpo_blocos(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.action_kpis (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.action_tools (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists sdpo_blocos_pilar_idx on public.sdpo_blocos(pilar_id);
create index if not exists sdpo_itens_bloco_idx on public.sdpo_itens(bloco_id);

do $$
declare t text;
begin
  foreach t in array array['sdpo_pilares','sdpo_blocos','sdpo_itens','action_kpis','action_tools'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_rw on public.%I', t, t);
    execute format('create policy %I_rw on public.%I for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id))', t, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

