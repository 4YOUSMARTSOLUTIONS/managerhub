create table if not exists public.individual_goal_rv (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  period date not null,
  total_value numeric not null default 0,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, owner_id, period)
);

alter table public.individual_goal_rv enable row level security;

-- dono, owner/admin, ou gestor do dono podem ler/gravar (espelha individual_goals)
create policy individual_goal_rv_rw on public.individual_goal_rv
  using (
    is_tenant_member(tenant_id) and (
      owner_id = auth.uid()
      or has_tenant_role(tenant_id, '{owner,admin}'::member_role[])
      or public.manages_user(owner_id, tenant_id)
    )
  )
  with check (
    is_tenant_member(tenant_id) and (
      owner_id = auth.uid()
      or has_tenant_role(tenant_id, '{owner,admin}'::member_role[])
      or public.manages_user(owner_id, tenant_id)
    )
  );
