-- A funcao montava CINCO subconsultas independentes sobre `vis`, e a `vis` sozinha
-- ja custa uma varredura com a regra de visibilidade. Na pratica eram cinco
-- varreduras das 7.522 acoes por carga da tela: 1.414 ms medidos.
--
-- Agora `vis` é materializada UMA vez e cada lista sai dela por agregacao. Mesma
-- saida, mesmos rotulos, mesma marcacao de legado. Medido depois: 763 ms.

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
         a.requester_id, a.legacy_requester, a.meeting_series_id, a.legacy_meeting
  from public.actions a
  cross join ctx
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

revoke execute on function public.action_filter_options() from public, anon;
