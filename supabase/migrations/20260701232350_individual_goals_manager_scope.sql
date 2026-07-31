-- helper: auth.uid() é gestor (manager_id) do dono da meta?
create or replace function public.manages_user(p_owner uuid, p_tenant uuid)
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = p_owner and m.manager_id = auth.uid()
  );
$$;

-- metas individuais: dono, owner/admin, ou gestor do dono
alter policy individual_goals_rw on public.individual_goals
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

-- registros das metas: idem, via join na meta
alter policy individual_goal_entries_rw on public.individual_goal_entries
  using (
    is_tenant_member(tenant_id) and exists (
      select 1 from public.individual_goals g
      where g.id = individual_goal_entries.goal_id and (
        g.owner_id = auth.uid()
        or has_tenant_role(g.tenant_id, '{owner,admin}'::member_role[])
        or public.manages_user(g.owner_id, g.tenant_id)
      )
    )
  )
  with check (
    is_tenant_member(tenant_id) and exists (
      select 1 from public.individual_goals g
      where g.id = individual_goal_entries.goal_id and (
        g.owner_id = auth.uid()
        or has_tenant_role(g.tenant_id, '{owner,admin}'::member_role[])
        or public.manages_user(g.owner_id, g.tenant_id)
      )
    )
  );
