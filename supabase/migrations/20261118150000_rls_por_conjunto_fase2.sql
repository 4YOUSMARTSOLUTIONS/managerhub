-- Regras de acesso por CONJUNTO nas tabelas que mais pesavam (fase 2 de
-- desempenho, LUIZ 18/11/2026). Mesmo princípio da agenda (20261118120000):
-- o que dependia de função avaliada LINHA A LINHA passa a ser um conjunto
-- calculado uma vez por consulta (`in (select ...)`).
--
-- Trocas literais, pela própria definição de cada função:
--   has_tenant_role(t, papéis)  ==  t in (select my_role_tenant_ids(papéis))
--       (mesmo corpo: super admin vê todas; papel bate ou is_hr com 'hr')
--   manages_user(u, t)          ==  (t, u) in (select ... my_managed_memberships())
--       (era literalmente `exists (... my_managed_memberships() ...)`)
--
-- Blitz: `pode_ver_blitz` também varria o "topo da hierarquia" da empresa a
-- cada linha. Agora as empresas em que a pessoa vê toda a blitz, as em que vê
-- tudo menos o topo, e o topo, saem de funções calculadas uma vez.
--
-- Filhas (atestados, e-mails do absenteísmo, respostas da blitz) passam a
-- depender da regra da tabela-mãe (`id in (select id from mãe)`), que já
-- aplica o mesmo critério.
--
-- Conferido: impressão digital (quantidade + hash dos registros) das 8 tabelas
-- para 16 perfis idêntica antes e depois.

-- ---------------------------------------------------------------------------
-- auxiliares da blitz
-- ---------------------------------------------------------------------------
-- empresas em que a pessoa vê a blitz de todo mundo: equipe de segurança,
-- owner/admin, ou Gerencial que enxerga o topo
create or replace function public.blitz_tenants_ve_tudo()
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select t.id from public.tenants t
   where public.pode_tratar_seguranca(t.id)
      or (public.has_tenant_role(t.id, '{manager}'::public.member_role[]) and public.ve_o_topo(t.id));
$function$;

-- empresas em que a pessoa é Gerencial e vê todos MENOS o topo da hierarquia
create or replace function public.blitz_tenants_sem_topo()
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select t.id from public.tenants t
   where public.has_tenant_role(t.id, '{manager}'::public.member_role[])
     and not public.ve_o_topo(t.id);
$function$;

-- o topo da hierarquia (ativos sem gestor) das empresas da pessoa
create or replace function public.seg_topos_dos_meus_tenants()
 returns table(tenant_id uuid, user_id uuid)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select m.tenant_id, m.user_id
    from public.memberships m
   where m.is_active and m.manager_id is null
     and m.tenant_id in (select public.my_tenant_ids());
$function$;

revoke execute on function public.blitz_tenants_ve_tudo() from public, anon;
revoke execute on function public.blitz_tenants_sem_topo() from public, anon;
revoke execute on function public.seg_topos_dos_meus_tenants() from public, anon;
grant execute on function public.blitz_tenants_ve_tudo() to authenticated;
grant execute on function public.blitz_tenants_sem_topo() to authenticated;
grant execute on function public.seg_topos_dos_meus_tenants() to authenticated;

-- ---------------------------------------------------------------------------
-- histórico de movimentações
-- ---------------------------------------------------------------------------
drop policy if exists membership_history_select on public.membership_history;
create policy membership_history_select on public.membership_history
  for select using (
    tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::public.member_role[]))
    or (tenant_id, user_id) in (select c.tenant_id, c.user_id from public.my_managed_memberships() c)
    or user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- afastamentos (employee_absences)
-- ---------------------------------------------------------------------------
drop policy if exists employee_absences_read on public.employee_absences;
create policy employee_absences_read on public.employee_absences
  for select using (
    tenant_id in (select public.my_role_tenant_ids('{owner,admin,manager,hr}'::public.member_role[])));

drop policy if exists employee_absences_read_equipe on public.employee_absences;
create policy employee_absences_read_equipe on public.employee_absences
  for select to authenticated using (
    (tenant_id, user_id) in (select c.tenant_id, c.user_id from public.my_managed_memberships() c));

drop policy if exists employee_absences_write on public.employee_absences;
create policy employee_absences_write on public.employee_absences
  for all
  using (tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::public.member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::public.member_role[])));

-- ---------------------------------------------------------------------------
-- férias
-- ---------------------------------------------------------------------------
drop policy if exists ferias_select on public.ferias_solicitacoes;
create policy ferias_select on public.ferias_solicitacoes
  for select using (
    user_id = (select auth.uid())
    or created_by = (select auth.uid())
    or (tenant_id, user_id) in (select c.tenant_id, c.user_id from public.my_managed_memberships() c)
    or tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr,manager}'::public.member_role[])));

-- ---------------------------------------------------------------------------
-- absenteísmo
-- ---------------------------------------------------------------------------
drop policy if exists absenteismo_select on public.absenteismo_lancamentos;
create policy absenteismo_select on public.absenteismo_lancamentos
  for select using (
    created_by = (select auth.uid())
    or (tenant_id, user_id) in (select c.tenant_id, c.user_id from public.my_managed_memberships() c)
    or tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::public.member_role[])));

drop policy if exists absenteismo_update on public.absenteismo_lancamentos;
create policy absenteismo_update on public.absenteismo_lancamentos
  for update
  using (
    created_by = (select auth.uid())
    or (tenant_id, user_id) in (select c.tenant_id, c.user_id from public.my_managed_memberships() c)
    or tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::public.member_role[])))
  with check (
    created_by = (select auth.uid())
    or (tenant_id, user_id) in (select c.tenant_id, c.user_id from public.my_managed_memberships() c)
    or tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::public.member_role[])));

drop policy if exists absenteismo_atestado_rw on public.absenteismo_atestados;
create policy absenteismo_atestado_rw on public.absenteismo_atestados
  for all
  using (lancamento_id in (select l.id from public.absenteismo_lancamentos l))
  with check (lancamento_id in (select l.id from public.absenteismo_lancamentos l));

drop policy if exists absenteismo_emails_select on public.absenteismo_emails;
create policy absenteismo_emails_select on public.absenteismo_emails
  for select using (lancamento_id in (select l.id from public.absenteismo_lancamentos l));

-- ---------------------------------------------------------------------------
-- blitz
-- ---------------------------------------------------------------------------
drop policy if exists seg_blitz_av_select on public.seg_blitz_avaliacoes;
create policy seg_blitz_av_select on public.seg_blitz_avaliacoes
  for select using (
    created_by = (select auth.uid())
    or user_id = (select auth.uid())
    or tenant_id in (select public.blitz_tenants_ve_tudo())
    or (tenant_id in (select public.blitz_tenants_sem_topo())
        and (tenant_id, user_id) not in (select t.tenant_id, t.user_id from public.seg_topos_dos_meus_tenants() t))
    or (tenant_id, user_id) in (select c.tenant_id, c.user_id from public.my_managed_memberships() c));

drop policy if exists seg_blitz_respostas_select on public.seg_blitz_respostas;
create policy seg_blitz_respostas_select on public.seg_blitz_respostas
  for select using (avaliacao_id in (select a.id from public.seg_blitz_avaliacoes a));
