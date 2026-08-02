-- Acrescenta o filtro de Programa (SPO/DPO) à busca e às opções dos selects.

-- ids da página + total, aplicando todos os filtros da tela sobre a base inteira
create or replace function public.search_action_ids(
  p_filters jsonb default '{}'::jsonb,
  p_limit int default 50,
  p_offset int default 0
) returns jsonb
language sql
stable
set search_path to 'public'
as $function$
with f as (
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
  where a.tenant_id = public.my_active_tenant()
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
    -- filtros de nível demanda: a ação entra se ao menos uma demanda casar
    and ((f.status is null and f.assignee is null) or exists (
          select 1 from public.action_demandas d
          where d.action_id = a.id
            and (f.status is null or public.demanda_eff_status(d.id) = f.status)
            and (f.assignee is null or
                 exists (select 1 from public.action_demanda_assignees s
                         join public.profiles pr on pr.id = s.user_id
                         where s.demanda_id = d.id and pr.full_name = f.assignee)
                 or exists (select 1 from unnest(string_to_array(coalesce(d.legacy_assignees, ''), ',')) u
                            where btrim(u) = f.assignee))
        ))
    -- busca livre: campos da ação ou de alguma demanda
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

-- opções dos selects a partir da base inteira (inclui os valores legacy da migração)
create or replace function public.action_filter_options()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
select jsonb_build_object(
  'programas', coalesce((
    select jsonb_agg(distinct nm order by nm) from (
      select coalesce((select pg.name from public.sdpo_programas pg where pg.id = a.programa_id), a.legacy_programa) as nm
      from public.actions a where a.tenant_id = public.my_active_tenant()
    ) t where nm is not null and btrim(nm) <> ''
  ), '[]'::jsonb),
  'pilares', coalesce((
    select jsonb_agg(distinct nm order by nm) from (
      select coalesce((select p.name from public.sdpo_pilares p where p.id = a.pilar_id), a.legacy_pilar) as nm
      from public.actions a where a.tenant_id = public.my_active_tenant()
    ) t where nm is not null and btrim(nm) <> ''
  ), '[]'::jsonb),
  'requesters', coalesce((
    select jsonb_agg(distinct nm order by nm) from (
      select coalesce((select pr.full_name from public.profiles pr where pr.id = a.requester_id), a.legacy_requester) as nm
      from public.actions a where a.tenant_id = public.my_active_tenant()
    ) t where nm is not null and btrim(nm) <> ''
  ), '[]'::jsonb),
  'assignees', coalesce((
    select jsonb_agg(distinct nm order by nm) from (
      select pr.full_name as nm
      from public.action_demanda_assignees s
      join public.profiles pr on pr.id = s.user_id
      join public.action_demandas d on d.id = s.demanda_id
      where d.tenant_id = public.my_active_tenant()
      union all
      select btrim(u)
      from public.action_demandas d2
      cross join unnest(string_to_array(coalesce(d2.legacy_assignees, ''), ',')) u
      where d2.tenant_id = public.my_active_tenant()
    ) t where nm is not null and btrim(nm) <> ''
  ), '[]'::jsonb)
);
$function$;
