-- Mesmo padrao das acoes, agora nas tabelas do nucleo. Medido antes, por sessao de
-- um membro comum:
--   audit_logs        8.404 ms para devolver ZERO linhas (has_tenant_role 60.873x)
--   demanda_events    1.778 ms
--   membership_units    475 ms
--   profiles            258 ms  (embutida em quase toda consulta do sistema)
--   memberships         120 ms
--
-- Atencao: politica `for all` tambem vale para SELECT. Por isso as de escrita
-- entram junto quando estao na mesma tabela lida em volume.
--
-- Depois: 314, 137, 11, 7 e 5 ms. Contagens e impressoes digitais identicas.

-- tenants onde tenho um dos papeis pedidos (espelha has_tenant_role)
create or replace function public.my_role_tenant_ids(p_roles member_role[])
returns setof uuid language sql stable security definer set search_path to 'public'
as $function$
  select t.id from public.tenants t where public.is_super_admin()
  union
  select m.tenant_id from public.memberships m
  where m.user_id = (select auth.uid()) and m.role = any(p_roles);
$function$;

-- pessoas que dividem alguma empresa comigo
create or replace function public.my_coworker_ids()
returns setof uuid language sql stable security definer set search_path to 'public'
as $function$
  select distinct m2.user_id
  from public.memberships m1
  join public.memberships m2 on m2.tenant_id = m1.tenant_id
  where m1.user_id = (select auth.uid());
$function$;

-- vinculos das empresas que enxergo
create or replace function public.my_visible_membership_ids()
returns setof uuid language sql stable security definer set search_path to 'public'
as $function$
  select m.id from public.memberships m
  where m.tenant_id in (select public.my_tenant_ids());
$function$;

-- vinculos das empresas onde sou owner/admin
create or replace function public.my_admin_membership_ids()
returns setof uuid language sql stable security definer set search_path to 'public'
as $function$
  select m.id from public.memberships m
  where m.tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[]));
$function$;

revoke execute on function public.my_role_tenant_ids(member_role[]) from public, anon;
revoke execute on function public.my_coworker_ids() from public, anon;
revoke execute on function public.my_visible_membership_ids() from public, anon;
revoke execute on function public.my_admin_membership_ids() from public, anon;

-- ---- audit_logs (60.873 linhas) ----
drop policy if exists "audit_admin_select" on public.audit_logs;
create policy "audit_admin_select" on public.audit_logs
  for select using (
    tenant_id in (select public.my_role_tenant_ids('{owner,admin,manager}'::member_role[]))
  );

-- ---- demanda_events (15.222 linhas) ----
drop policy if exists "demanda_events_rw" on public.demanda_events;
create policy "demanda_events_rw" on public.demanda_events
  for all using (tenant_id in (select public.my_tenant_ids()))
  with check (tenant_id in (select public.my_tenant_ids()));

-- ---- profiles ----
drop policy if exists "profiles_self_select" on public.profiles;
create policy "profiles_self_select" on public.profiles
  for select using (
    (select public.is_super_admin())
    or id = (select auth.uid())
    or id in (select public.my_coworker_ids())
  );

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update using (id = (select auth.uid()));

drop policy if exists "profiles_self_insert" on public.profiles;
create policy "profiles_self_insert" on public.profiles
  for insert with check (id = (select auth.uid()));

-- ---- memberships ----
drop policy if exists "memberships_select" on public.memberships;
create policy "memberships_select" on public.memberships
  for select using (
    user_id = (select auth.uid()) or tenant_id in (select public.my_tenant_ids())
  );

drop policy if exists "memberships_admin_write" on public.memberships;
create policy "memberships_admin_write" on public.memberships
  for all using (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));

drop policy if exists "memberships_self_insert" on public.memberships;
create policy "memberships_self_insert" on public.memberships
  for insert with check (user_id = (select auth.uid()));

-- ---- membership_units ----
drop policy if exists "membership_units_select" on public.membership_units;
create policy "membership_units_select" on public.membership_units
  for select using (membership_id in (select public.my_visible_membership_ids()));

drop policy if exists "membership_units_write" on public.membership_units;
create policy "membership_units_write" on public.membership_units
  for all using (membership_id in (select public.my_admin_membership_ids()))
  with check (membership_id in (select public.my_admin_membership_ids()));
