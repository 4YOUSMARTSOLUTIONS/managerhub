-- Filtro de Reuniao na tela de Acoes. Como em Pilar e nas pessoas, o valor casa por
-- NOME e cobre os dois mundos: a serie vinculada e o texto que veio da migracao
-- (7387 das 7522 acoes so tem legacy_meeting, em 62 nomes distintos).
--
-- Legado = o nome nao corresponde a uma serie viva do tenant (inexistente, inativa
-- ou excluida). A tela agrupa esses no fim da lista, em cinza.

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
vis as (
  select a.id, a.programa_id, a.legacy_programa, a.pilar_id, a.legacy_pilar,
         a.requester_id, a.legacy_requester, a.meeting_series_id, a.legacy_meeting
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
  -- ativos primeiro (legacy=false ordena antes), depois os legados, ambos em ordem alfabética
  'pilares', coalesce((
    select jsonb_agg(jsonb_build_object('nome', nm, 'legacy', leg) order by leg, nm)
    from (
      select distinct nm,
             not exists (
               select 1 from public.sdpo_pilares p, ctx
               where p.tenant_id = ctx.tenant and p.name = nm and p.active
             ) as leg
      from (
        select coalesce((select p.name from public.sdpo_pilares p where p.id = v.pilar_id), v.legacy_pilar) as nm
        from vis v
      ) x where nm is not null and btrim(nm) <> ''
    ) t
  ), '[]'::jsonb),
  'meetings', coalesce((
    select jsonb_agg(jsonb_build_object('nome', nm, 'legacy', leg) order by leg, nm)
    from (
      select distinct nm,
             not exists (
               select 1 from public.meeting_series s, ctx
               where s.tenant_id = ctx.tenant and s.name = nm
                 and s.is_active and s.deleted_at is null
             ) as leg
      from (
        select coalesce((select s.name from public.meeting_series s where s.id = v.meeting_series_id), v.legacy_meeting) as nm
        from vis v
      ) x where nm is not null and btrim(nm) <> ''
    ) t
  ), '[]'::jsonb),
  'requesters', coalesce((
    select jsonb_agg(jsonb_build_object('nome', nm, 'legacy', leg) order by leg, nm)
    from (
      select distinct nm, nm not in (select a.nm from ativos a) as leg
      from (
        select coalesce((select pr.full_name from public.profiles pr where pr.id = v.requester_id), v.legacy_requester) as nm
        from vis v
      ) x where nm is not null and btrim(nm) <> ''
    ) t
  ), '[]'::jsonb),
  'assignees', coalesce((
    select jsonb_agg(jsonb_build_object('nome', nm, 'legacy', leg) order by leg, nm)
    from (
      select distinct nm, nm not in (select a.nm from ativos a) as leg
      from (
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
      ) x where nm is not null and btrim(nm) <> ''
    ) t
  ), '[]'::jsonb)
);
$function$;

revoke execute on function public.action_filter_options() from public, anon;
