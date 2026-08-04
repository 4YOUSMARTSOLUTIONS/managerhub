-- A tela de Configuracoes baixava a tabela de ACOES INTEIRA (7.522 linhas) so para
-- montar conjuntos de "ids ja usados" e decidir se cada item do catalogo pode ser
-- excluido ou apenas desativado. Fazia o mesmo com todos os chamados.
--
-- Aqui a conta e feita no banco e volta so a lista de ids realmente em uso.
--
-- Sem SECURITY DEFINER de proposito: a funcao roda com os privilegios de quem
-- chama, entao a RLS continua valendo dentro dela e nao ha nova superficie a
-- proteger.
create or replace function public.catalog_usage(p_tenant uuid)
returns table(
  pilar_ids uuid[], secao_ids uuid[], bloco_ids uuid[], item_ids uuid[],
  kpi_ids uuid[], tool_ids uuid[],
  department_ids uuid[], subdepartment_ids uuid[], position_ids uuid[], level_ids uuid[],
  sector_ids uuid[], category_ids uuid[], competency_ids uuid[]
)
language sql stable set search_path to 'public'
as $function$
  with a as (
    select
      array_agg(distinct pilar_id) filter (where pilar_id is not null) as pilar_ids,
      array_agg(distinct secao_id) filter (where secao_id is not null) as secao_ids,
      array_agg(distinct bloco_id) filter (where bloco_id is not null) as bloco_ids,
      array_agg(distinct item_id)  filter (where item_id  is not null) as item_ids,
      array_agg(distinct kpi_id)   filter (where kpi_id   is not null) as kpi_ids,
      array_agg(distinct tool_id)  filter (where tool_id  is not null) as tool_ids
    from public.actions where tenant_id = p_tenant
  ),
  d as (
    select array_agg(distinct x) filter (where x is not null) as ids from (
      select department_id as x from public.memberships where tenant_id = p_tenant
      union all select department_id from public.area_goals where tenant_id = p_tenant
      union all select department_id from public.checklists where tenant_id = p_tenant
      union all select department_id from public.feedback_cadence_rules where tenant_id = p_tenant
    ) s
  ),
  sd as (
    select array_agg(distinct x) filter (where x is not null) as ids from (
      select subdepartment_id as x from public.memberships where tenant_id = p_tenant
      union all select subdepartment_id from public.area_goals where tenant_id = p_tenant
      union all select subdepartment_id from public.checklists where tenant_id = p_tenant
    ) s
  ),
  po as (
    select array_agg(distinct x) filter (where x is not null) as ids from (
      select position_id as x from public.memberships where tenant_id = p_tenant
      union all select position_id from public.feedback_cadence_rules where tenant_id = p_tenant
      union all select position_id from public.individual_rv_config where tenant_id = p_tenant
    ) s
  ),
  lv as (
    select array_agg(distinct position_level_id) filter (where position_level_id is not null) as ids
    from public.memberships where tenant_id = p_tenant
  ),
  tk as (
    select array_agg(distinct sector_id) filter (where sector_id is not null) as sector_ids,
           array_agg(distinct category_id) filter (where category_id is not null) as category_ids
    from public.tickets where tenant_id = p_tenant
  ),
  fc as (
    select array_agg(distinct competency_id) filter (where competency_id is not null) as ids
    from public.feedback_competency_links where tenant_id = p_tenant
  )
  select a.pilar_ids, a.secao_ids, a.bloco_ids, a.item_ids, a.kpi_ids, a.tool_ids,
         d.ids, sd.ids, po.ids, lv.ids, tk.sector_ids, tk.category_ids, fc.ids
  from a, d, sd, po, lv, tk, fc;
$function$;

revoke execute on function public.catalog_usage(uuid) from public, anon;
