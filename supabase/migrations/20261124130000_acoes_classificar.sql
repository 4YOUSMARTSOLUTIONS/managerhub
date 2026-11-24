-- Classificar a lista de Ações por Data de criação, Status ou Prazo (LUIZ, 24/11/2026).
--
-- A lista pagina no banco (50 por página), então a ordem TEM de ser decidida aqui:
-- ordenar só na tela ordenaria a página aberta e mentiria sobre as outras.
--
-- p_filters ganha duas chaves:
--   ord: 'criada' (padrão) | 'status' | 'prazo'
--   dir: 'asc' | 'desc'   (ausente: criada desc, status e prazo asc)
--
-- Status segue a URGÊNCIA, não o alfabeto: Atrasada, Aguardando aprovação,
-- Em andamento, Concluída, Cancelada. Dentro do mesmo status, o prazo mais perto
-- vem antes. Prazo vazio fica sempre no fim, nos dois sentidos.
--
-- Hoje toda ação tem uma demanda só; se vier a ter mais, a ação entra na posição
-- da sua primeira linha naquela ordem (min no crescente, max no decrescente),
-- contando só as demandas que passam no filtro de status, que são as exibidas.
--
-- A chave de ordem só é calculada quando a ordem não é a padrão: o caso comum
-- continua custando o mesmo que antes (~250 ms com as 21 mil; status/prazo ~+130 ms).

create or replace function public.search_action_ids(p_filters jsonb default '{}'::jsonb, p_limit integer default 50, p_offset integer default 0)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
with ctx as (
  select public.my_active_tenant() as tenant, auth.uid() as uid, public.is_tenant_member(public.my_active_tenant()) as membro
),
f0 as (
  select case when p_filters->>'ord' in ('status', 'prazo') then p_filters->>'ord' else 'criada' end as ord
),
f as (
  select
    f0.ord,
    case when p_filters->>'dir' in ('asc', 'desc') then p_filters->>'dir'
         when f0.ord = 'criada' then 'desc' else 'asc' end as dir,
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
    case when jsonb_typeof(p_filters->'bloco') = 'array'
      then (select array_agg(v) from jsonb_array_elements_text(p_filters->'bloco') v) end as bloco,
    case when jsonb_typeof(p_filters->'item') = 'array'
      then (select array_agg(v) from jsonb_array_elements_text(p_filters->'item') v) end as item,
    case when jsonb_typeof(p_filters->'kpi') = 'array'
      then (select array_agg(v) from jsonb_array_elements_text(p_filters->'kpi') v) end as kpi,
    case when jsonb_typeof(p_filters->'tool') = 'array'
      then (select array_agg(v) from jsonb_array_elements_text(p_filters->'tool') v) end as tool,
    case when jsonb_typeof(p_filters->'meeting') = 'array'
      then (select array_agg(v) from jsonb_array_elements_text(p_filters->'meeting') v) end as meeting,
    case when jsonb_typeof(p_filters->'requester') = 'array'
      then (select array_agg(v) from jsonb_array_elements_text(p_filters->'requester') v) end as requester,
    case when jsonb_typeof(p_filters->'assignee') = 'array'
      then (select array_agg(v) from jsonb_array_elements_text(p_filters->'assignee') v) end as assignee,
    case when jsonb_typeof(p_filters->'mine') = 'array'
      then (select array_agg(v) from jsonb_array_elements_text(p_filters->'mine') v) end as mine,
    case when jsonb_typeof(p_filters->'dept') = 'array'
      then (select array_agg(v::uuid) from jsonb_array_elements_text(p_filters->'dept') v) end as dept,
    case when jsonb_typeof(p_filters->'sub') = 'array'
      then (select array_agg(v::uuid) from jsonb_array_elements_text(p_filters->'sub') v) end as sub,
    case when jsonb_typeof(p_filters->'units') = 'array'
      then (select array_agg(v::uuid) from jsonb_array_elements_text(p_filters->'units') v) end as units
  from f0
),
-- as minhas e as em aberto saem dos índices uma vez só, em vez de uma subconsulta por ação
minhas as materialized (
  select d3.action_id as id
    from public.action_demanda_assignees x3
    join public.action_demandas d3 on d3.id = x3.demanda_id
    cross join f cross join ctx
   where 'resp' = any(f.mine) and x3.user_id = ctx.uid and d3.tenant_id = ctx.tenant
  union
  select a3.id
    from public.actions a3 cross join f cross join ctx
   where 'sol' = any(f.mine) and a3.requester_id = ctx.uid and a3.tenant_id = ctx.tenant
  union
  select a3.id
    from public.actions a3 cross join f cross join ctx
   where 'cri' = any(f.mine) and a3.created_by = ctx.uid and a3.tenant_id = ctx.tenant
),
abertas as materialized (
  select distinct d4.action_id as id
    from public.action_demandas d4 cross join f cross join ctx
   where f.status is not null
     and not (f.status && array['concluida', 'cancelada']::text[])
     and d4.tenant_id = ctx.tenant
     and d4.status not in ('done', 'cancelled')
),
base as materialized (
  select a.id, a.created_at
  from public.actions a
  cross join f
  cross join ctx
  where a.tenant_id = ctx.tenant
    and ctx.membro
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
    and (f.mine is null or a.id in (select m.id from minhas m))
    and (f.status is null
         or f.status && array['concluida', 'cancelada']::text[]
         or a.id in (select ab.id from abertas ab))
    and (f.units is null or a.unit_id is null or a.unit_id = any(f.units))
    and (f.dept is null or a.department_id = any(f.dept))
    and (f.sub is null or a.subdepartment_id = any(f.sub))
    and (f.priority is null or a.priority::text = any(f.priority))
    and (f.sdpo is null or a.is_sdpo = (f.sdpo = 'sim'))
    and (f.dfrom is null or a.created_at::date >= f.dfrom)
    and (f.dto is null or a.created_at::date <= f.dto)
    and (f.programa is null or coalesce(
          (select pg.name from public.sdpo_programas pg where pg.id = a.programa_id), a.legacy_programa) = any(f.programa))
    and (f.pilar is null or coalesce(
          (select p.name from public.sdpo_pilares p where p.id = a.pilar_id), a.legacy_pilar) = any(f.pilar))
    and (f.bloco is null or coalesce(
          (select b.name from public.sdpo_blocos b where b.id = a.bloco_id), a.legacy_bloco) = any(f.bloco))
    and (f.item is null or coalesce(
          (select i.name from public.sdpo_itens i where i.id = a.item_id), a.legacy_item) = any(f.item))
    and (f.kpi is null or coalesce(
          (select k.name from public.action_kpis k where k.id = a.kpi_id), a.legacy_kpi) = any(f.kpi))
    and (f.tool is null or coalesce(
          (select t.name from public.action_tools t where t.id = a.tool_id), a.legacy_tool) = any(f.tool))
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
         or public.mh_norm('#' || a.code::text) like '%' || f.q || '%'
         or exists (
              select 1 from public.action_demandas d
              where d.action_id = a.id
                and public.mh_norm(d.description) like '%' || f.q || '%'
            ))
),
-- quem pediu conclusão e ainda espera aprovação: poucas centenas de linhas, lidas
-- uma vez só e só quando a ordem não é a padrão (o CTE nem é tocado no outro ramo)
pend as materialized (
  select s.demanda_id
    from public.action_demanda_assignees s
   where s.done_requested_at is not null and s.completed_at is null
)
select jsonb_build_object(
  'total', (select count(*) from base),
  -- Dois ramos, e o CASE só executa o escolhido. A primeira versão calculava a
  -- chave de ordem num CTE agrupado e juntava com o resultado: o planejador
  -- errava a estimativa e comparava cada ação com todas as outras (40 s com as
  -- 21 mil). Aqui a chave sai por ação, pelo índice de action_demandas (130 ms).
  'ids', case when (select f.ord from f) = 'criada' then
    coalesce((
      select jsonb_agg(x.id)
      from (
        select b.id from base b cross join f
         order by case when f.dir = 'asc' then b.created_at end asc, b.created_at desc, b.id
         limit greatest(p_limit, 0) offset greatest(p_offset, 0)
      ) x
    ), '[]'::jsonb)
  else
    coalesce((
      select jsonb_agg(x.id)
      from (
        select b.id
          from base b
          cross join f
          left join lateral (
            -- status efetivo: o mesmo cálculo do filtro acima e de effStatus() na tela
            select min(k.st) as st_min, max(k.st) as st_max,
                   min(k.due_date) as prazo_min, max(k.due_date) as prazo_max
              from (
                select d.due_date,
                       array_position(array['atrasada', 'aguardando', 'andamento', 'concluida', 'cancelada'],
                         case
                           when d.status = 'cancelled' then 'cancelada'
                           when d.status = 'done' then 'concluida'
                           when d.id in (select p.demanda_id from pend p) then 'aguardando'
                           when d.due_date is not null and d.due_date < current_date then 'atrasada'
                           else 'andamento'
                         end) as st
                  from public.action_demandas d
                 where d.action_id = b.id
              ) k
             -- só as demandas exibidas, que são as que passam no filtro de status
             where f.status is null
                or (array['atrasada', 'aguardando', 'andamento', 'concluida', 'cancelada'])[k.st] = any(f.status)
          ) c on true
         order by
           case when f.ord = 'status' and f.dir = 'asc'  then c.st_min end asc nulls last,
           case when f.ord = 'status' and f.dir = 'desc' then c.st_max end desc nulls last,
           case when f.ord = 'prazo'  and f.dir = 'asc'  then c.prazo_min end asc nulls last,
           case when f.ord = 'prazo'  and f.dir = 'desc' then c.prazo_max end desc nulls last,
           -- dentro do mesmo status, o prazo mais perto primeiro
           case when f.ord = 'status' then c.prazo_min end asc nulls last,
           b.created_at desc,
           b.id
         limit greatest(p_limit, 0) offset greatest(p_offset, 0)
      ) x
    ), '[]'::jsonb)
  end
);
$function$;

revoke execute on function public.search_action_ids(jsonb, integer, integer) from public, anon;
grant execute on function public.search_action_ids(jsonb, integer, integer) to authenticated;

notify pgrst, 'reload schema';
