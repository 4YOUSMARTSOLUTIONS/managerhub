-- Desempenho da busca de ações: com 7.5k ações a tela levava 13-30s.
-- Causa: as funções eram SECURITY INVOKER, então a RLS (can_view_action) era avaliada
-- linha a linha, 7.522 vezes, cada uma com subconsultas próprias.
--
-- Agora são SECURITY DEFINER e a MESMA regra de visibilidade do can_view_action é
-- reproduzida de forma conjunta (os conjuntos são montados uma vez e reaproveitados).
-- O escopo continua preso a my_active_tenant() e a associação é conferida uma vez.

create or replace function public.search_action_ids(
  p_filters jsonb default '{}'::jsonb,
  p_limit int default 50,
  p_offset int default 0
) returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with ctx as (
  select public.my_active_tenant() as tenant, auth.uid() as uid
),
f as (
  select
    nullif(public.mh_norm(nullif(btrim(p_filters->>'q'), '')), '') as q,
    nullif(p_filters->>'priority', '')       as priority,
    nullif(p_filters->>'sdpo', '')           as sdpo,
    nullif(p_filters->>'status', '')         as status,
    nullif(p_filters->>'programa', '')       as programa,
    nullif(p_filters->>'pilar', '')          as pilar,
    nullif(p_filters->>'requester', '')      as requester,
    nullif(p_filters->>'assignee', '')       as assignee,
    nullif(p_filters->>'from', '')::date     as dfrom,
    nullif(p_filters->>'to', '')::date       as dto,
    case when jsonb_typeof(p_filters->'units') = 'array'
      then (select array_agg(x::uuid) from jsonb_array_elements_text(p_filters->'units') x)
    end as units
),
base as (
  select a.id, a.created_at
  from public.actions a
  cross join f
  cross join ctx
  where a.tenant_id = ctx.tenant
    and public.is_tenant_member(ctx.tenant)
    -- visibilidade: mesma regra do can_view_action, porém em conjuntos (não por linha)
    and (
      a.meeting_series_id is null
      or a.meeting_series_id in (
           select s.id from public.meeting_series s
           where s.tenant_id = ctx.tenant and public.can_view_series(s.*))
      or a.requester_id = ctx.uid
      or a.created_by = ctx.uid
      or a.id in (select c.action_id from public.action_cc c where c.user_id = ctx.uid)
      or a.id in (select d2.action_id from public.action_demandas d2
                  join public.action_demanda_assignees x2 on x2.demanda_id = d2.id
                  where x2.user_id = ctx.uid)
    )
    and (f.units is null or a.unit_id is null or a.unit_id = any(f.units))
    and (f.priority is null or a.priority::text = f.priority)
    and (f.sdpo is null or a.is_sdpo = (f.sdpo = 'sim'))
    and (f.dfrom is null or a.created_at::date >= f.dfrom)
    and (f.dto is null or a.created_at::date <= f.dto)
    and (f.programa is null or coalesce(
          (select pg.name from public.sdpo_programas pg where pg.id = a.programa_id), a.legacy_programa) = f.programa)
    and (f.pilar is null or coalesce(
          (select p.name from public.sdpo_pilares p where p.id = a.pilar_id), a.legacy_pilar) = f.pilar)
    and (f.requester is null or coalesce(
          (select pr.full_name from public.profiles pr where pr.id = a.requester_id), a.legacy_requester) = f.requester)
    -- nível demanda: a ação entra se ao menos uma demanda casar (status efetivo em linha)
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
                  else 'andamento' end) = f.status)
            and (f.assignee is null or
                 exists (select 1 from public.action_demanda_assignees s
                         join public.profiles pr on pr.id = s.user_id
                         where s.demanda_id = d.id and pr.full_name = f.assignee)
                 or exists (select 1 from unnest(string_to_array(coalesce(d.legacy_assignees, ''), ',')) u
                            where btrim(u) = f.assignee))
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

-- opções dos selects: mesmo escopo e mesma visibilidade
create or replace function public.action_filter_options()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with ctx as (
  select public.my_active_tenant() as tenant, auth.uid() as uid
),
vis as (
  select a.id, a.programa_id, a.legacy_programa, a.pilar_id, a.legacy_pilar,
         a.requester_id, a.legacy_requester
  from public.actions a cross join ctx
  where a.tenant_id = ctx.tenant
    and public.is_tenant_member(ctx.tenant)
    and (
      a.meeting_series_id is null
      or a.meeting_series_id in (
           select s.id from public.meeting_series s
           where s.tenant_id = ctx.tenant and public.can_view_series(s.*))
      or a.requester_id = ctx.uid
      or a.created_by = ctx.uid
      or a.id in (select c.action_id from public.action_cc c where c.user_id = ctx.uid)
      or a.id in (select d2.action_id from public.action_demandas d2
                  join public.action_demanda_assignees x2 on x2.demanda_id = d2.id
                  where x2.user_id = ctx.uid)
    )
)
select jsonb_build_object(
  'programas', coalesce((
    select jsonb_agg(distinct nm order by nm) from (
      select coalesce((select pg.name from public.sdpo_programas pg where pg.id = v.programa_id), v.legacy_programa) as nm
      from vis v
    ) t where nm is not null and btrim(nm) <> ''
  ), '[]'::jsonb),
  'pilares', coalesce((
    select jsonb_agg(distinct nm order by nm) from (
      select coalesce((select p.name from public.sdpo_pilares p where p.id = v.pilar_id), v.legacy_pilar) as nm
      from vis v
    ) t where nm is not null and btrim(nm) <> ''
  ), '[]'::jsonb),
  'requesters', coalesce((
    select jsonb_agg(distinct nm order by nm) from (
      select coalesce((select pr.full_name from public.profiles pr where pr.id = v.requester_id), v.legacy_requester) as nm
      from vis v
    ) t where nm is not null and btrim(nm) <> ''
  ), '[]'::jsonb),
  'assignees', coalesce((
    select jsonb_agg(distinct nm order by nm) from (
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
    ) t where nm is not null and btrim(nm) <> ''
  ), '[]'::jsonb)
);
$function$;

-- índices para a listagem e os filtros mais usados
create index if not exists actions_tenant_created_idx on public.actions (tenant_id, created_at desc);
create index if not exists action_demandas_action_idx on public.action_demandas (action_id);
create index if not exists action_demanda_assignees_user_idx on public.action_demanda_assignees (user_id);
