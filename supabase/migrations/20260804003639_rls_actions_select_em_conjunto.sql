-- A politica de SELECT de `actions` era `can_view_action(actions.*)`. Funcoes
-- SECURITY DEFINER NUNCA sao incorporadas pelo planner, entao ela virava caixa-preta
-- executada linha a linha: 7.522 chamadas, cada uma consultando memberships,
-- meeting_series e mais tres subconsultas. Medido: 2.583 ms contra 39 ms para o
-- MESMO resultado quando a regra e resolvida em conjunto.
--
-- A regra abaixo e a MESMA, termo a termo. O que muda e a forma: auxiliares que
-- devolvem CONJUNTOS, usados em `in (select ...)`, que o planner resolve uma vez
-- (vira hashed SubPlan / InitPlan no plano).
--
-- can_view_action segue existindo e continua valendo para UPDATE e DELETE, que
-- operam sobre poucas linhas e nao sofrem com o custo por linha.
--
-- Verificado antes e depois, por impressao digital do conjunto visivel: owner e
-- member enxergam exatamente as mesmas 7.522 linhas, e quem esta fora da empresa
-- continua enxergando zero. Depois: 26 ms.

-- tenants onde sou membro. Espelha is_tenant_member: super admin ve todos, e nao
-- ha filtro por is_active (fidelidade ao comportamento atual).
create or replace function public.my_tenant_ids()
returns setof uuid language sql stable security definer set search_path to 'public'
as $function$
  select t.id from public.tenants t where public.is_super_admin()
  union
  select m.tenant_id from public.memberships m where m.user_id = (select auth.uid());
$function$;

-- series de reuniao que posso ver (a propria can_view_series decide; sao poucas)
create or replace function public.my_visible_series_ids()
returns setof uuid language sql stable security definer set search_path to 'public'
as $function$
  select s.id from public.meeting_series s where public.can_view_series(s.*);
$function$;

-- acoes em que estou em copia
create or replace function public.my_cc_action_ids()
returns setof uuid language sql stable security definer set search_path to 'public'
as $function$
  select c.action_id from public.action_cc c where c.user_id = (select auth.uid());
$function$;

-- acoes em que sou responsavel por alguma demanda
create or replace function public.my_assigned_action_ids()
returns setof uuid language sql stable security definer set search_path to 'public'
as $function$
  select d.action_id from public.action_demandas d
  join public.action_demanda_assignees x on x.demanda_id = d.id
  where x.user_id = (select auth.uid());
$function$;

revoke execute on function public.my_tenant_ids() from public, anon;
revoke execute on function public.my_visible_series_ids() from public, anon;
revoke execute on function public.my_cc_action_ids() from public, anon;
revoke execute on function public.my_assigned_action_ids() from public, anon;

drop policy if exists "actions_select" on public.actions;
create policy "actions_select" on public.actions
  for select using (
    tenant_id in (select public.my_tenant_ids())
    and (
      meeting_series_id is null
      or meeting_series_id in (select public.my_visible_series_ids())
      or requester_id = (select auth.uid())
      or created_by = (select auth.uid())
      or id in (select public.my_cc_action_ids())
      or id in (select public.my_assigned_action_ids())
    )
  );
