-- A busca livre varria pilar, seção, bloco, item, solicitante, reunião, KPI,
-- ferramenta, descrição da demanda, responsáveis legados e nome de responsável.
--
-- O resultado vinha cheio de ação sem o termo em lugar nenhum visível na linha:
-- quem digitava um nome caía em tudo o que aquela pessoa pediu ou executa, e não
-- tinha como saber por que a linha estava ali. Cada um desses campos tem filtro
-- próprio ao lado, que recorta sem ambiguidade.
--
-- Passa a casar só ID (#código) e descrição da demanda.
--
-- Transforma a definição vigente em vez de reescrever a função: a âncora é
-- verificada, então a migração falha alto se o corpo divergir.
do $outer$
declare
  src text; antes text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'search_action_ids';

  if src is null then raise exception 'search_action_ids não encontrada'; end if;

  alvo := E'    and (f.q is null\n'
       || E'         or public.mh_norm(concat_ws('' '',\n'
       || E'              ''#'' || a.code::text,\n'
       || E'              coalesce((select pg.name from public.sdpo_programas pg where pg.id = a.programa_id), a.legacy_programa),\n'
       || E'              coalesce((select p.name from public.sdpo_pilares p where p.id = a.pilar_id), a.legacy_pilar),\n'
       || E'              coalesce((select sc.name from public.sdpo_secoes sc where sc.id = a.secao_id), a.legacy_secao),\n'
       || E'              coalesce((select b.name from public.sdpo_blocos b where b.id = a.bloco_id), a.legacy_bloco),\n'
       || E'              coalesce((select i.name from public.sdpo_itens i where i.id = a.item_id), a.legacy_item),\n'
       || E'              coalesce((select pr.full_name from public.profiles pr where pr.id = a.requester_id), a.legacy_requester),\n'
       || E'              coalesce((select s.name from public.meeting_series s where s.id = a.meeting_series_id), a.legacy_meeting),\n'
       || E'              coalesce((select k.name from public.action_kpis k where k.id = a.kpi_id), a.legacy_kpi),\n'
       || E'              coalesce((select t.name from public.action_tools t where t.id = a.tool_id), a.legacy_tool)\n'
       || E'            )) like ''%'' || f.q || ''%''\n'
       || E'         or exists (\n'
       || E'              select 1 from public.action_demandas d\n'
       || E'              where d.action_id = a.id\n'
       || E'                and (public.mh_norm(concat_ws('' '', d.description, d.legacy_assignees)) like ''%'' || f.q || ''%''\n'
       || E'                     or exists (select 1 from public.action_demanda_assignees s\n'
       || E'                                join public.profiles pr on pr.id = s.user_id\n'
       || E'                                where s.demanda_id = d.id\n'
       || E'                                  and public.mh_norm(pr.full_name) like ''%'' || f.q || ''%''))\n'
       || E'            ))';

  novo := E'    and (f.q is null\n'
       || E'         or public.mh_norm(''#'' || a.code::text) like ''%'' || f.q || ''%''\n'
       || E'         or exists (\n'
       || E'              select 1 from public.action_demandas d\n'
       || E'              where d.action_id = a.id\n'
       || E'                and public.mh_norm(d.description) like ''%'' || f.q || ''%''\n'
       || E'            ))';

  antes := src; src := replace(src, alvo, novo);
  if src = antes then raise exception 'âncora da busca livre não encontrada'; end if;

  execute src;
end $outer$;

-- AGENTS.md: SECURITY DEFINER em public sai do alcance da chave pública.
revoke execute on function public.search_action_ids(jsonb, integer, integer) from public, anon;
grant execute on function public.search_action_ids(jsonb, integer, integer) to authenticated;
