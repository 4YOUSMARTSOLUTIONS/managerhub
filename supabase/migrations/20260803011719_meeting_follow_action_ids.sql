-- O follow de uma serie grande era lento pelo mesmo motivo que /acoes era: a RLS
-- avalia can_view_action POR LINHA. Na RLP o plano rodava a funcao ~3000 vezes
-- (985 acoes no scan + 2x por linha num subplano), 2,6 s numa consulta so.
--
-- Aqui a visibilidade e resolvida em CONJUNTO, uma vez, e a funcao devolve apenas
-- os ids das acoes que o painel realmente mostra: as que tem demanda aberta ou
-- concluida depois do corte, fora as criadas na ocorrencia atual.

create or replace function public.meeting_follow_action_ids(
  p_series uuid,
  p_occurrence uuid,
  p_cutoff date
) returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with ctx as (
  select public.my_active_tenant() as tenant, auth.uid() as uid
),
vis as (
  select a.id
  from public.actions a
  cross join ctx
  where a.tenant_id = ctx.tenant
    and a.meeting_series_id = p_series
    and public.is_tenant_member(ctx.tenant)
    and (a.occurrence_id is null or a.occurrence_id <> p_occurrence)
    -- mesma regra do can_view_action, porem em conjuntos (nao por linha)
    and (
      a.meeting_series_id in (
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
select coalesce((
  select jsonb_agg(distinct v.id)
  from vis v
  join public.action_demandas d on d.action_id = v.id
  where d.status in ('open', 'in_progress', 'blocked')
     or (d.status = 'done' and d.completed_at >= p_cutoff)
), '[]'::jsonb);
$function$;

revoke execute on function public.meeting_follow_action_ids(uuid, uuid, date) from public, anon;
