-- Faltavam quatro listas: Bloco, Item, KPI e Ferramenta de gestão. As colunas
-- existem na tabela de ações desde sempre, e a busca livre até casava por elas,
-- mas não havia filtro, então o único jeito de recortar era digitar o nome e
-- torcer. Agora que a busca casa só ID e descrição, sem estes o recorte por esses
-- campos deixaria de existir.
--
-- Mesmo padrão das que já existiam: nome resolvido do cadastro com queda para o
-- valor legado da importação, e marcação `legacy` para o que saiu do cadastro ou
-- foi desativado, que ordena depois e ganha dica na tela.
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
         a.bloco_id, a.legacy_bloco, a.item_id, a.legacy_item,
         a.kpi_id, a.legacy_kpi, a.tool_id, a.legacy_tool,
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
    coalesce(b.name, v.legacy_bloco) as bloco,
    coalesce(i.name, v.legacy_item) as item,
    coalesce(k.name, v.legacy_kpi) as kpi,
    coalesce(t.name, v.legacy_tool) as ferramenta,
    coalesce(s.name, v.legacy_meeting) as reuniao,
    coalesce(pr.full_name, v.legacy_requester) as solicitante
  from vis v
  left join public.sdpo_programas pg on pg.id = v.programa_id
  left join public.sdpo_pilares p on p.id = v.pilar_id
  left join public.sdpo_blocos b on b.id = v.bloco_id
  left join public.sdpo_itens i on i.id = v.item_id
  left join public.action_kpis k on k.id = v.kpi_id
  left join public.action_tools t on t.id = v.tool_id
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
  'blocos', coalesce((
    select jsonb_agg(jsonb_build_object('nome', nm, 'legacy', leg) order by leg, nm)
    from (
      select distinct bloco as nm,
             not exists (select 1 from public.sdpo_blocos b, ctx
                         where b.tenant_id = ctx.tenant and b.name = nomes.bloco and b.active) as leg
      from nomes where bloco is not null and btrim(bloco) <> ''
    ) t
  ), '[]'::jsonb),
  'itens', coalesce((
    select jsonb_agg(jsonb_build_object('nome', nm, 'legacy', leg) order by leg, nm)
    from (
      select distinct item as nm,
             not exists (select 1 from public.sdpo_itens i, ctx
                         where i.tenant_id = ctx.tenant and i.name = nomes.item and i.active) as leg
      from nomes where item is not null and btrim(item) <> ''
    ) t
  ), '[]'::jsonb),
  'kpis', coalesce((
    select jsonb_agg(jsonb_build_object('nome', nm, 'legacy', leg) order by leg, nm)
    from (
      select distinct kpi as nm,
             not exists (select 1 from public.action_kpis k, ctx
                         where k.tenant_id = ctx.tenant and k.name = nomes.kpi and k.active) as leg
      from nomes where kpi is not null and btrim(kpi) <> ''
    ) t
  ), '[]'::jsonb),
  'tools', coalesce((
    select jsonb_agg(jsonb_build_object('nome', nm, 'legacy', leg) order by leg, nm)
    from (
      select distinct ferramenta as nm,
             not exists (select 1 from public.action_tools t2, ctx
                         where t2.tenant_id = ctx.tenant and t2.name = nomes.ferramenta and t2.active) as leg
      from nomes where ferramenta is not null and btrim(ferramenta) <> ''
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

-- AGENTS.md: SECURITY DEFINER em public sai do alcance da chave pública.
revoke execute on function public.action_filter_options() from public, anon;
grant execute on function public.action_filter_options() to authenticated;
