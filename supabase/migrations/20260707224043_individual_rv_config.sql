create table public.individual_rv_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scope text not null check (scope in ('position','user')),
  position_id uuid references public.positions(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  effective_from date not null,
  value numeric not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((scope='position' and position_id is not null and user_id is null)
      or (scope='user' and user_id is not null and position_id is null))
);
create unique index irc_pos_uniq on public.individual_rv_config(tenant_id, position_id, effective_from) where scope='position';
create unique index irc_user_uniq on public.individual_rv_config(tenant_id, user_id, effective_from) where scope='user';
alter table public.individual_rv_config enable row level security;
create policy irc_admin_all on public.individual_rv_config
  using (is_tenant_member(tenant_id) and has_tenant_role(tenant_id, '{owner,admin}'::member_role[]))
  with check (is_tenant_member(tenant_id) and has_tenant_role(tenant_id, '{owner,admin}'::member_role[]));
drop table if exists public.individual_goal_rv;
