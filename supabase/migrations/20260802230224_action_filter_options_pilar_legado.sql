-- Pilares do filtro passam a informar se são "legados": não existem mais no cadastro
-- (vieram da migração) ou foram desativados. A tela usa isso para separá-los e
-- apresentá-los em cinza, depois dos ativos.

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
