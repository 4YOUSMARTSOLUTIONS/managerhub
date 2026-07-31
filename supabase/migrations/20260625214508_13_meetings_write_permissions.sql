
-- =============================================================
-- MANAGERHUB · Migration 13 · Permissão de escrita em reuniões
-- Alterar/excluir: somente criador, admin ou owner.
-- Criar: qualquer membro. Ver: qualquer membro.
-- =============================================================

-- remove a política ampla anterior (FOR ALL para qualquer membro)
drop policy if exists "meetings_member_write" on public.meetings;

-- INSERT: qualquer membro do tenant pode criar
create policy "meetings_insert" on public.meetings
  for insert
  with check (public.is_tenant_member(tenant_id));

-- UPDATE: criador OU admin/owner
create policy "meetings_update" on public.meetings
  for update
  using (
    created_by = auth.uid()
    or public.has_tenant_role(tenant_id, array['owner','admin']::member_role[])
  )
  with check (
    created_by = auth.uid()
    or public.has_tenant_role(tenant_id, array['owner','admin']::member_role[])
  );

-- DELETE: criador OU admin/owner
create policy "meetings_delete" on public.meetings
  for delete
  using (
    created_by = auth.uid()
    or public.has_tenant_role(tenant_id, array['owner','admin']::member_role[])
  );

