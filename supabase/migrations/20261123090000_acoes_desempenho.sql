-- Velocidade da tela de Ações (LUIZ, 23/11/2026).
--
-- 1. A busca conferia "minhas" e o status ação por ação, nas 20,9 mil. Agora calcula
--    uma vez o conjunto das minhas e o das que estão em aberto. A regra de quem vê
--    o quê não muda.
-- 2. `acoes_da_pagina` traz as linhas da tela numa consulta só. Antes eram 5 idas ao
--    banco, e cada uma remontava pela RLS a lista inteira do que a pessoa alcança
--    para devolver 50 linhas.

create index if not exists action_demandas_abertas_idx
  on public.action_demandas (tenant_id, action_id)
  where status not in ('done', 'cancelled');

do $migracao$
declare
  v_def text := pg_get_functiondef('public.search_action_ids(jsonb,integer,integer)'::regprocedure);
  v_base text := $a$),
base as ($a$;
  v_conjuntos text := $b$),
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
base as ($b$;
  v_mine text := $c$    and (f.mine is null or (
         ('sol'  = any(f.mine) and a.requester_id = ctx.uid)
      or ('cri'  = any(f.mine) and a.created_by = ctx.uid)
      or ('resp' = any(f.mine) and exists (
            select 1 from public.action_demandas d3
            join public.action_demanda_assignees x3 on x3.demanda_id = d3.id
            where d3.action_id = a.id and x3.user_id = ctx.uid))
    ))$c$;
  v_mine_novo text := $d$    and (f.mine is null or a.id in (select m.id from minhas m))
    and (f.status is null
         or f.status && array['concluida', 'cancelada']::text[]
         or a.id in (select ab.id from abertas ab))$d$;
  v_ctx text := 'select public.my_active_tenant() as tenant, auth.uid() as uid';
  v_ctx_novo text := 'select public.my_active_tenant() as tenant, auth.uid() as uid, public.is_tenant_member(public.my_active_tenant()) as membro';
  v_membro text := 'and public.is_tenant_member(ctx.tenant)';
begin
  v_def := replace(v_def, E'\r\n', E'\n');
  if position(v_base in v_def) = 0 or position(v_mine in v_def) = 0 then
    raise exception 'search_action_ids: trecho esperado não encontrado';
  end if;
  v_def := replace(replace(v_def, v_base, v_conjuntos), v_mine, v_mine_novo);

  -- a filiação à empresa era conferida uma vez POR AÇÃO: era o maior custo da busca
  if position(v_ctx in v_def) = 0 or position(v_membro in v_def) = 0 then
    raise exception 'search_action_ids: contexto não encontrado';
  end if;
  execute replace(replace(v_def, v_ctx, v_ctx_novo), v_membro, 'and ctx.membro');
end
$migracao$;

revoke execute on function public.search_action_ids(jsonb, integer, integer) from public, anon;
grant execute on function public.search_action_ids(jsonb, integer, integer) to authenticated;

create or replace function public.acoes_da_pagina(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with ctx as materialized (
  select public.my_active_tenant() as tenant, auth.uid() as uid
),
-- a mesma regra de visibilidade de search_action_ids e da RLS de actions
vis as materialized (
  select a.*, array_position(p_ids, a.id) as ordem
    from public.actions a
    cross join ctx
   where a.id = any(p_ids)
     and cardinality(p_ids) <= 200
     and a.tenant_id = ctx.tenant
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
dem as materialized (
  select d.* from public.action_demandas d where d.action_id in (select v.id from vis v)
),
resp as materialized (
  select x.* from public.action_demanda_assignees x where x.demanda_id in (select d.id from dem d)
),
copia as materialized (
  select c.action_id, c.user_id from public.action_cc c where c.action_id in (select v.id from vis v)
),
anexos as materialized (
  select an.id, an.action_id, an.demanda_id, an.filename, an.path, an.created_at
    from public.action_attachments an
   where an.action_id in (select v.id from vis v)
),
-- só os nomes de quem aparece nestas linhas
nomes as materialized (
  select m.user_id, coalesce(pr.full_name, '—') as nome
    from public.memberships m
    left join public.profiles pr on pr.id = m.user_id
    cross join ctx
   where m.tenant_id = ctx.tenant
     and m.user_id in (
       select r.user_id from resp r
       union select c.user_id from copia c
       union select v.requester_id from vis v where v.requester_id is not null
     )
),
coment as materialized (
  select e.demanda_id, count(*)::int as n
    from public.demanda_events e
   where e.type = 'comment' and e.demanda_id in (select d.id from dem d)
   group by e.demanda_id
),
por_demanda as (
  select d.action_id,
         jsonb_agg(jsonb_build_object(
           'id', d.id,
           'description', d.description,
           'status', d.status,
           'dueDate', d.due_date,
           'assigneeNames', (
             select coalesce(jsonb_agg(z.nome order by z.o, z.nome), '[]'::jsonb)
               from (
                 select coalesce(n.nome, '—') as nome, 0 as o
                   from resp x left join nomes n on n.user_id = x.user_id
                  where x.demanda_id = d.id
                 union all
                 select btrim(u), 1
                   from unnest(string_to_array(coalesce(d.legacy_assignees, ''), ',')) u
                  where btrim(u) <> ''
               ) z
           ),
           'assigneeIds', (
             select coalesce(jsonb_agg(x.user_id order by coalesce(n.nome, '—'), x.user_id), '[]'::jsonb)
               from resp x left join nomes n on n.user_id = x.user_id
              where x.demanda_id = d.id
           ),
           'assigneeStates', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'id', x.user_id,
                      'name', coalesce(n.nome, '—'),
                      'doneRequestedAt', x.done_requested_at,
                      'completedAt', x.completed_at
                    ) order by coalesce(n.nome, '—'), x.user_id), '[]'::jsonb)
               from resp x left join nomes n on n.user_id = x.user_id
              where x.demanda_id = d.id
           ),
           'pendingCount', (
             select count(*)::int from resp x
              where x.demanda_id = d.id and x.done_requested_at is not null and x.completed_at is null
           ),
           'commentCount', coalesce((select c.n from coment c where c.demanda_id = d.id), 0),
           'attachments', (
             select coalesce(jsonb_agg(jsonb_build_object('id', an.id, 'filename', an.filename, 'path', an.path)
                      order by an.created_at, an.id), '[]'::jsonb)
               from anexos an where an.demanda_id = d.id
           )
         ) order by d.created_at, d.id) as demandas
    from dem d
   group by d.action_id
)
select coalesce(jsonb_agg(jsonb_build_object(
         'id', v.id,
         'code', v.code,
         'isSdpo', v.is_sdpo,
         'programaName', coalesce(pg.name, v.legacy_programa),
         'pilarName', coalesce(pi.name, v.legacy_pilar),
         'secaoName', coalesce(se.name, v.legacy_secao),
         'blocoName', coalesce(bl.name, v.legacy_bloco),
         'itemName', coalesce(it.name, v.legacy_item),
         'seriesName', coalesce(s.name, v.legacy_meeting),
         'occurredOn', o.occurred_on,
         'kpiName', coalesce(k.name, v.legacy_kpi),
         'toolName', coalesce(t.name, v.legacy_tool),
         'unitId', v.unit_id,
         'legacyUnit', v.legacy_unit,
         'requesterId', v.requester_id,
         'createdById', v.created_by,
         'requesterName', coalesce((select n.nome from nomes n where n.user_id = v.requester_id), v.legacy_requester),
         'problem', v.problem_statement,
         'createdAt', v.created_at,
         'priority', v.priority,
         'dueDate', v.due_date,
         'demandas', coalesce(pd.demandas, '[]'::jsonb),
         'ccNames', (
           select coalesce(jsonb_agg(coalesce(n.nome, '—') order by coalesce(n.nome, '—')), '[]'::jsonb)
             from copia c left join nomes n on n.user_id = c.user_id
            where c.action_id = v.id
         ),
         'attachments', (
           select coalesce(jsonb_agg(jsonb_build_object('id', an.id, 'filename', an.filename, 'path', an.path)
                    order by an.created_at, an.id), '[]'::jsonb)
             from anexos an where an.action_id = v.id and an.demanda_id is null
         )
       ) order by v.ordem), '[]'::jsonb)
  from vis v
  left join por_demanda pd on pd.action_id = v.id
  left join public.sdpo_programas pg on pg.id = v.programa_id and pg.tenant_id = v.tenant_id
  left join public.sdpo_pilares pi on pi.id = v.pilar_id and pi.tenant_id = v.tenant_id
  left join public.sdpo_secoes se on se.id = v.secao_id and se.tenant_id = v.tenant_id
  left join public.sdpo_blocos bl on bl.id = v.bloco_id and bl.tenant_id = v.tenant_id
  left join public.sdpo_itens it on it.id = v.item_id and it.tenant_id = v.tenant_id
  left join public.meeting_series s on s.id = v.meeting_series_id and s.tenant_id = v.tenant_id and s.deleted_at is null
  left join public.meeting_occurrences o on o.id = v.occurrence_id and o.tenant_id = v.tenant_id and o.deleted_at is null
  left join public.action_kpis k on k.id = v.kpi_id and k.tenant_id = v.tenant_id
  left join public.action_tools t on t.id = v.tool_id and t.tenant_id = v.tenant_id;
$function$;

revoke execute on function public.acoes_da_pagina(uuid[]) from public, anon;
grant execute on function public.acoes_da_pagina(uuid[]) to authenticated;

notify pgrst, 'reload schema';
