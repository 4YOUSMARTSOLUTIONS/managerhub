-- Duas exceções nas metas.
--
-- 1. META PRÓPRIA DO GERENCIAL. As metas individuais eram sempre de cima para
--    baixo: owner/admin, ou o gestor da pessoa. Quem tem papel Gerencial e não
--    aparece como gestor de ninguém (ou é o topo da cadeia) não conseguia
--    cadastrar NEM AS PRÓPRIAS metas, e dependia de um admin. Passa a poder,
--    e só para si: `owner_id = auth.uid()`.
--    Editar e excluir acompanham, senão ele cria e não conserta.
--
-- 2. META DE ÁREA POR QUEM LIDERA. Era exclusiva de owner/admin. Gestor
--    (team_lead) e Gerencial (manager) passam a criar. Para não virar terra de
--    ninguém, o `for all` foi quebrado: alterar e excluir seguem com owner e
--    admin, mais QUEM CRIOU a meta (created_by), que cuida da própria.

-- ---------- 1. individual_goals: a meta própria do Gerencial
drop policy if exists individual_goals_insert on public.individual_goals;
create policy individual_goals_insert on public.individual_goals
  for insert with check (
    tenant_id in (select public.my_tenant_ids())
    and (
      tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[]))
      or (owner_id, tenant_id) in (select user_id, tenant_id from public.my_managed_memberships())
      -- exceção: o Gerencial cadastra as PRÓPRIAS metas
      or (owner_id = (select auth.uid())
          and tenant_id in (select public.my_role_tenant_ids('{manager}'::member_role[])))
    )
  );

drop policy if exists individual_goals_update on public.individual_goals;
create policy individual_goals_update on public.individual_goals
  for update using (
    tenant_id in (select public.my_tenant_ids())
    and (
      tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[]))
      or (owner_id, tenant_id) in (select user_id, tenant_id from public.my_managed_memberships())
      or (owner_id = (select auth.uid())
          and tenant_id in (select public.my_role_tenant_ids('{manager}'::member_role[])))
    )
  );

drop policy if exists individual_goals_delete on public.individual_goals;
create policy individual_goals_delete on public.individual_goals
  for delete using (
    tenant_id in (select public.my_tenant_ids())
    and (
      tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[]))
      or (owner_id, tenant_id) in (select user_id, tenant_id from public.my_managed_memberships())
      or (owner_id = (select auth.uid())
          and tenant_id in (select public.my_role_tenant_ids('{manager}'::member_role[])))
    )
  );

-- ---------- 2. area_goals: quem lidera cria; quem criou (ou a chefia) mantém
drop policy if exists area_goals_write on public.area_goals;

create policy area_goals_insert on public.area_goals
  for insert with check (
    tenant_id in (select public.my_role_tenant_ids('{owner,admin,manager,team_lead}'::member_role[]))
  );

create policy area_goals_update on public.area_goals
  for update using (
    tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[]))
    or (created_by = (select auth.uid())
        and tenant_id in (select public.my_role_tenant_ids('{manager,team_lead}'::member_role[])))
  ) with check (
    tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[]))
    or (created_by = (select auth.uid())
        and tenant_id in (select public.my_role_tenant_ids('{manager,team_lead}'::member_role[])))
  );

create policy area_goals_delete on public.area_goals
  for delete using (
    tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[]))
    or (created_by = (select auth.uid())
        and tenant_id in (select public.my_role_tenant_ids('{manager,team_lead}'::member_role[])))
  );
