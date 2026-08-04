-- A tela de Acoes era a mais lenta do sistema, e o plano mostrou a linha exata:
--
--   Index Scan on meeting_series (1,24 ms) ... loops=1120
--
-- A subconsulta de "quais reunioes posso ver" referenciava ctx.tenant, que vem de
-- um cross join. Isso a torna CORRELACIONADA aos olhos do planner: em vez de
-- resolver uma vez, ele a re-executava 1.120 vezes (uma por acao com reuniao), e
-- cada execucao chamava can_view_series por dentro. 1.120 x 1,24 ms = 1,4 s, o
-- custo inteiro da funcao.
--
-- A troca por my_visible_series_ids() (sem referencia externa) deixa o planner
-- resolver o conjunto uma vez, como hashed SubPlan. Semanticamente identico: as
-- acoes ja estao presas ao tenant ativo pela clausula a.tenant_id = ctx.tenant,
-- entao series de outros tenants nunca casariam de qualquer forma.
--
-- Medido na sessao real do owner:
--   action_filter_options   1.597 ms -> 86 ms (72 ms na segunda chamada)
--   search_action_ids         206 ms -> 110 ms
-- Equivalencia conferida: o plano antigo agregava exatamente 69 solicitantes e
-- 83 responsaveis; a funcao nova devolve exatamente 69 e 83.

create or replace function public.action_filter_options()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
with ctx as (
  select public.my_active_tenant() as tenant, auth.uid() as uid
),
ativos as (
  select pr.full_name as nm
  from public.memberships m
  join public.profiles pr on pr.id = m.user_id
  cross join ctx
  where m.tenant_id = ctx.tenant and m.is_active and pr.full_name is not null
),
-- materializada de proposito: sem isto o planner reexecuta a visibilidade por lista
vis as materialized (
  select a.id, a.programa_id, a.legacy_programa, a.pilar_id, a.legacy_pilar,
         a.requester_id, a.legacy_requester, a.meeting_series_id, a.legacy_meeting
  from public.actions a
  cross join ctx
  where a.tenant_id = ctx.tenant
    and public.is_tenant_member(ctx.tenant)
    and (
      a.meeting_series_id is null
      or a.meeting_series_id in (select public.my_visible_series_ids())
      or a.requester_id = ctx.uid
      or a.created_by = ctx.uid
      or a.id in (select c.action_id from public.action_cc c where c.user_id = ctx.uid)
      or a.id in (select d2.action_id from public.action_demandas d2
                  join public.action_demanda_assignees x2 on x2.demanda_id = d2.id
                  where x2.user_id = ctx.uid)
    )
),
-- os nomes resolvidos de uma vez só, em vez de um subselect por linha por lista
nomes as materialized (
  select
    coalesce(pg.name, v.legacy_programa) as programa,
    coalesce(p.name, v.legacy_pilar) as pilar,
    coalesce(s.name, v.legacy_meeting) as reuniao,
    coalesce(pr.full_name, v.legacy_requester) as solicitante
  from vis v
  left join public.sdpo_programas pg on pg.id = v.programa_id
  left join public.sdpo_pilares p on p.id = v.pilar_id
  left join public.meeting_series s on s.id = v.meeting_series_id
  left join public.profiles pr on pr.id = v.requester_id
),
responsaveis as materialized (
  select pr.full_name as nm
  from public.action_demandas d
  join vis v on v.id = d.action_id
  join public.action_demanda_assignees s on s.demanda_id = d.id
  join public.profiles pr on pr.id = s.user_id
  union all
  select btrim(u)
  from public.action_demandas d2
  join vis v2 on v2.id = d2.action_id
  cross join unnest(string_to_array(coalesce(d2.legacy_assignees, ''), ',')) u
)
select jsonb_build_object(
  'programas', coalesce((
    select jsonb_agg(distinct programa order by programa)
    from nomes where programa is not null and btrim(programa) <> ''
  ), '[]'::jsonb),
  -- ativos primeiro (legacy=false ordena antes), depois os legados, ambos em ordem alfabética
  'pilares', coalesce((
    select jsonb_agg(jsonb_build_object('nome', nm, 'legacy', leg) order by leg, nm)
    from (
      select distinct pilar as nm,
             not exists (select 1 from public.sdpo_pilares p, ctx
                         where p.tenant_id = ctx.tenant and p.name = nomes.pilar and p.active) as leg
      from nomes where pilar is not null and btrim(pilar) <> ''
    ) t
  ), '[]'::jsonb),
  'meetings', coalesce((
    select jsonb_agg(jsonb_build_object('nome', nm, 'legacy', leg) order by leg, nm)
    from (
      select distinct reuniao as nm,
             not exists (select 1 from public.meeting_series s, ctx
                         where s.tenant_id = ctx.tenant and s.name = nomes.reuniao
                           and s.is_active and s.deleted_at is null) as leg
      from nomes where reuniao is not null and btrim(reuniao) <> ''
    ) t
  ), '[]'::jsonb),
  'requesters', coalesce((
    select jsonb_agg(jsonb_build_object('nome', nm, 'legacy', leg) order by leg, nm)
    from (
      select distinct solicitante as nm, solicitante not in (select a.nm from ativos a) as leg
      from nomes where solicitante is not null and btrim(solicitante) <> ''
    ) t
  ), '[]'::jsonb),
  'assignees', coalesce((
    select jsonb_agg(jsonb_build_object('nome', nm, 'legacy', leg) order by leg, nm)
    from (
      select distinct nm, nm not in (select a.nm from ativos a) as leg
      from responsaveis where nm is not null and btrim(nm) <> ''
    ) t
  ), '[]'::jsonb)
);
$function$;

create or replace function public.search_action_ids(p_filters jsonb default '{}'::jsonb, p_limit integer default 50, p_offset integer default 0)
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
with ctx as (
  select public.my_active_tenant() as tenant, auth.uid() as uid
),
f as (
  select
    nullif(public.mh_norm(nullif(btrim(p_filters->>'q'), '')), '') as q,
    nullif(p_filters->>'sdpo', '') as sdpo,
    nullif(p_filters->>'from', '')::date as dfrom,
    nullif(p_filters->>'to', '')::date as dto,
    case when jsonb_typeof(p_filters->'priority') = 'array'
      then (select array_agg(v) from jsonb_array_elements_text(p_filters->'priority') v) end as priority,
    case when jsonb_typeof(p_filters->'status') = 'array'
      then (select array_agg(v) from jsonb_array_elements_text(p_filters->'status') v) end as status,
    case when jsonb_typeof(p_filters->'programa') = 'array'
      then (select array_agg(v) from jsonb_array_elements_text(p_filters->'programa') v) end as programa,
    case when jsonb_typeof(p_filters->'pilar') = 'array'
      then (select array_agg(v) from jsonb_array_elements_text(p_filters->'pilar') v) end as pilar,
    case when jsonb_typeof(p_filters->'meeting') = 'array'
      then (select array_agg(v) from jsonb_array_elements_text(p_filters->'meeting') v) end as meeting,
    case when jsonb_typeof(p_filters->'requester') = 'array'
      then (select array_agg(v) from jsonb_array_elements_text(p_filters->'requester') v) end as requester,
    case when jsonb_typeof(p_filters->'assignee') = 'array'
      then (select array_agg(v) from jsonb_array_elements_text(p_filters->'assignee') v) end as assignee,
    case when jsonb_typeof(p_filters->'units') = 'array'
      then (select array_agg(v::uuid) from jsonb_array_elements_text(p_filters->'units') v) end as units
),
base as (
  select a.id, a.created_at
  from public.actions a
  cross join f
  cross join ctx
  where a.tenant_id = ctx.tenant
    and public.is_tenant_member(ctx.tenant)
    -- mesma regra do can_view_action, porém em conjuntos (não por linha)
    and (
      a.meeting_series_id is null
      or a.meeting_series_id in (select public.my_visible_series_ids())
      or a.requester_id = ctx.uid
      or a.created_by = ctx.uid
      or a.id in (select c.action_id from public.action_cc c where c.user_id = ctx.uid)
      or a.id in (select d2.action_id from public.action_demandas d2
                  join public.action_demanda_assignees x2 on x2.demanda_id = d2.id
                  where x2.user_id = ctx.uid)
    )
    and (f.units is null or a.unit_id is null or a.unit_id = any(f.units))
    and (f.priority is null or a.priority::text = any(f.priority))
    and (f.sdpo is null or a.is_sdpo = (f.sdpo = 'sim'))
    and (f.dfrom is null or a.created_at::date >= f.dfrom)
    and (f.dto is null or a.created_at::date <= f.dto)
    and (f.programa is null or coalesce(
          (select pg.name from public.sdpo_programas pg where pg.id = a.programa_id), a.legacy_programa) = any(f.programa))
    and (f.pilar is null or coalesce(
          (select p.name from public.sdpo_pilares p where p.id = a.pilar_id), a.legacy_pilar) = any(f.pilar))
    and (f.meeting is null or coalesce(
          (select s.name from public.meeting_series s where s.id = a.meeting_series_id), a.legacy_meeting) = any(f.meeting))
    and (f.requester is null or coalesce(
          (select pr.full_name from public.profiles pr where pr.id = a.requester_id), a.legacy_requester) = any(f.requester))
    and ((f.status is null and f.assignee is null) or exists (
          select 1 from public.action_demandas d
          where d.action_id = a.id
            and (f.status is null or (case
                  when d.status = 'cancelled' then 'cancelada'
                  when d.status = 'done' then 'concluida'
                  when exists (select 1 from public.action_demanda_assignees s
                               where s.demanda_id = d.id and s.done_requested_at is not null and s.completed_at is null)
                    then 'aguardando'
                  when d.due_date is not null and d.due_date < current_date then 'atrasada'
                  else 'andamento' end) = any(f.status))
            and (f.assignee is null or
                 exists (select 1 from public.action_demanda_assignees s
                         join public.profiles pr on pr.id = s.user_id
                         where s.demanda_id = d.id and pr.full_name = any(f.assignee))
                 or exists (select 1 from unnest(string_to_array(coalesce(d.legacy_assignees, ''), ',')) u
                            where btrim(u) = any(f.assignee)))
        ))
    and (f.q is null
         or public.mh_norm(concat_ws(' ',
              '#' || a.code::text,
              coalesce((select pg.name from public.sdpo_programas pg where pg.id = a.programa_id), a.legacy_programa),
              coalesce((select p.name from public.sdpo_pilares p where p.id = a.pilar_id), a.legacy_pilar),
              coalesce((select sc.name from public.sdpo_secoes sc where sc.id = a.secao_id), a.legacy_secao),
              coalesce((select b.name from public.sdpo_blocos b where b.id = a.bloco_id), a.legacy_bloco),
              coalesce((select i.name from public.sdpo_itens i where i.id = a.item_id), a.legacy_item),
              coalesce((select pr.full_name from public.profiles pr where pr.id = a.requester_id), a.legacy_requester),
              coalesce((select s.name from public.meeting_series s where s.id = a.meeting_series_id), a.legacy_meeting),
              coalesce((select k.name from public.action_kpis k where k.id = a.kpi_id), a.legacy_kpi),
              coalesce((select t.name from public.action_tools t where t.id = a.tool_id), a.legacy_tool)
            )) like '%' || f.q || '%'
         or exists (
              select 1 from public.action_demandas d
              where d.action_id = a.id
                and (public.mh_norm(concat_ws(' ', d.description, d.legacy_assignees)) like '%' || f.q || '%'
                     or exists (select 1 from public.action_demanda_assignees s
                                join public.profiles pr on pr.id = s.user_id
                                where s.demanda_id = d.id
                                  and public.mh_norm(pr.full_name) like '%' || f.q || '%'))
            ))
)
select jsonb_build_object(
  'total', (select count(*) from base),
  'ids', coalesce((
    select jsonb_agg(x.id)
    from (select id from base order by created_at desc limit greatest(p_limit, 0) offset greatest(p_offset, 0)) x
  ), '[]'::jsonb)
);
$function$;

revoke execute on function public.action_filter_options() from public, anon;
revoke execute on function public.search_action_ids(jsonb, integer, integer) from public, anon;
