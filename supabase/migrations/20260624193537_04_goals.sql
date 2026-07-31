
-- =============================================================
-- MANAGERHUB · Migration 04 · Metas do time
-- =============================================================
create type goal_status as enum ('active', 'at_risk', 'achieved', 'missed', 'archived');

create table public.goals (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  title         text not null,
  description   text,
  owner_id      uuid references public.profiles(id) on delete set null,
  unit          text not null default '',
  target_value  numeric not null default 0,
  current_value numeric not null default 0,
  period_start  date,
  period_end    date,
  status        goal_status not null default 'active',
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_goals_tenant on public.goals(tenant_id);
create index idx_goals_owner on public.goals(owner_id);
create trigger trg_goals_updated before update on public.goals
  for each row execute function public.set_updated_at();

create table public.goal_updates (
  id          uuid primary key default gen_random_uuid(),
  goal_id     uuid not null references public.goals(id) on delete cascade,
  value       numeric not null,
  note        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index idx_goal_updates_goal on public.goal_updates(goal_id);

-- ao registrar progresso, atualiza o valor atual da meta
create or replace function public.apply_goal_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.goals set current_value = new.value, updated_at = now()
  where id = new.goal_id;
  return new;
end;
$$;
create trigger trg_goal_update_apply after insert on public.goal_updates
  for each row execute function public.apply_goal_update();

alter table public.goals        enable row level security;
alter table public.goal_updates enable row level security;

create policy "goals_member_select" on public.goals
  for select using (public.is_tenant_member(tenant_id));
create policy "goals_manager_write" on public.goals
  for all using (public.has_tenant_role(tenant_id, array['owner','admin','manager']::member_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin','manager']::member_role[]));

create policy "goal_updates_member_select" on public.goal_updates
  for select using (
    exists (select 1 from public.goals g
            where g.id = goal_id and public.is_tenant_member(g.tenant_id))
  );
create policy "goal_updates_member_write" on public.goal_updates
  for all using (
    exists (select 1 from public.goals g
            where g.id = goal_id and public.is_tenant_member(g.tenant_id))
  ) with check (
    exists (select 1 from public.goals g
            where g.id = goal_id and public.is_tenant_member(g.tenant_id))
  );

