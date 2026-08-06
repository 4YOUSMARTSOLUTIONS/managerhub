-- Os quatro filtros novos (Bloco, Item, KPI, Ferramenta) precisam existir também
-- na busca do banco, senão a tela ofereceria a opção e o recorte não aconteceria.
--
-- Casam por NOME, como os de pilar e reunião que já existiam, porque a lista de
-- opções vem de nome resolvido com queda para o valor legado da importação: casar
-- por id deixaria de fora justamente as ações antigas (1.101 têm o item só como
-- texto legado, contra 8 com item do cadastro).
--
-- Transforma a definição vigente em vez de reescrever a função; as âncoras são
-- verificadas, então a migração falha alto se o corpo divergir.
do $outer$
declare
  src text; antes text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'search_action_ids';

  if src is null then raise exception 'search_action_ids não encontrada'; end if;

  alvo := E'    case when jsonb_typeof(p_filters->''pilar'') = ''array''\n'
       || E'      then (select array_agg(v) from jsonb_array_elements_text(p_filters->''pilar'') v) end as pilar,\n';
  novo := alvo
       || E'    case when jsonb_typeof(p_filters->''bloco'') = ''array''\n'
       || E'      then (select array_agg(v) from jsonb_array_elements_text(p_filters->''bloco'') v) end as bloco,\n'
       || E'    case when jsonb_typeof(p_filters->''item'') = ''array''\n'
       || E'      then (select array_agg(v) from jsonb_array_elements_text(p_filters->''item'') v) end as item,\n'
       || E'    case when jsonb_typeof(p_filters->''kpi'') = ''array''\n'
       || E'      then (select array_agg(v) from jsonb_array_elements_text(p_filters->''kpi'') v) end as kpi,\n'
       || E'    case when jsonb_typeof(p_filters->''tool'') = ''array''\n'
       || E'      then (select array_agg(v) from jsonb_array_elements_text(p_filters->''tool'') v) end as tool,\n';
  antes := src; src := replace(src, alvo, novo);
  if src = antes then raise exception 'âncora 1 (leitura dos filtros) não encontrada'; end if;

  alvo := E'    and (f.pilar is null or coalesce(\n'
       || E'          (select p.name from public.sdpo_pilares p where p.id = a.pilar_id), a.legacy_pilar) = any(f.pilar))\n';
  novo := alvo
       || E'    and (f.bloco is null or coalesce(\n'
       || E'          (select b.name from public.sdpo_blocos b where b.id = a.bloco_id), a.legacy_bloco) = any(f.bloco))\n'
       || E'    and (f.item is null or coalesce(\n'
       || E'          (select i.name from public.sdpo_itens i where i.id = a.item_id), a.legacy_item) = any(f.item))\n'
       || E'    and (f.kpi is null or coalesce(\n'
       || E'          (select k.name from public.action_kpis k where k.id = a.kpi_id), a.legacy_kpi) = any(f.kpi))\n'
       || E'    and (f.tool is null or coalesce(\n'
       || E'          (select t.name from public.action_tools t where t.id = a.tool_id), a.legacy_tool) = any(f.tool))\n';
  antes := src; src := replace(src, alvo, novo);
  if src = antes then raise exception 'âncora 2 (predicados) não encontrada'; end if;

  execute src;
end $outer$;

-- AGENTS.md: SECURITY DEFINER em public sai do alcance da chave pública.
revoke execute on function public.search_action_ids(jsonb, integer, integer) from public, anon;
grant execute on function public.search_action_ids(jsonb, integer, integer) to authenticated;
