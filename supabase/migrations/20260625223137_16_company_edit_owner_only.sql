
-- Dados da empresa: somente o owner pode alterar
drop policy if exists "tenants_admin_update" on public.tenants;

create policy "tenants_owner_update" on public.tenants
  for update
  using (public.has_tenant_role(id, array['owner']::member_role[]))
  with check (public.has_tenant_role(id, array['owner']::member_role[]));

