-- Mesmo tratamento das acoes para as duas tabelas filhas mais lidas do sistema.
-- Elas chamavam can_view_action dentro de um EXISTS, o que executava a funcao
-- SECURITY DEFINER por linha (e, dentro dela, mais consultas).
--
-- A regra continua identica: "vejo a demanda se vejo a acao dela". Muda a forma.
--
-- Verificado antes e depois pela impressao digital do conjunto visivel: as mesmas
-- 7.522 demandas e os mesmos 7.522 responsaveis. O join das tres tabelas com RLS
-- passou a rodar em 83 ms.

-- conjunto de acoes visiveis, resolvido uma vez por consulta
create or replace function public.my_visible_action_ids()
returns setof uuid language sql stable security definer set search_path to 'public'
as $function$
  select a.id
  from public.actions a
  where a.tenant_id in (select public.my_tenant_ids())
    and (
      a.meeting_series_id is null
      or a.meeting_series_id in (select public.my_visible_series_ids())
      or a.requester_id = (select auth.uid())
      or a.created_by = (select auth.uid())
      or a.id in (select public.my_cc_action_ids())
      or a.id in (select public.my_assigned_action_ids())
    );
$function$;

-- conjunto de demandas visiveis (as das acoes acima)
create or replace function public.my_visible_demanda_ids()
returns setof uuid language sql stable security definer set search_path to 'public'
as $function$
  select d.id from public.action_demandas d
  where d.action_id in (select public.my_visible_action_ids());
$function$;

revoke execute on function public.my_visible_action_ids() from public, anon;
revoke execute on function public.my_visible_demanda_ids() from public, anon;

drop policy if exists "action_demandas_rw" on public.action_demandas;
create policy "action_demandas_rw" on public.action_demandas
  for all using (action_id in (select public.my_visible_action_ids()))
  with check (action_id in (select public.my_visible_action_ids()));

drop policy if exists "ada_rw" on public.action_demanda_assignees;
create policy "ada_rw" on public.action_demanda_assignees
  for all using (demanda_id in (select public.my_visible_demanda_ids()))
  with check (demanda_id in (select public.my_visible_demanda_ids()));
