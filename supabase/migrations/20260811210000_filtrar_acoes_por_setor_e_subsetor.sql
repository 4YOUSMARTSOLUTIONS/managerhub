-- Filtrar ações por Setor e Subsetor.
--
-- As colunas `department_id` e `subdepartment_id` entraram na ação na migração
-- 20260811190000 e já saem na exportação. Faltava a busca: sem isso, classificar
-- a ação por setor não servia para recortar a lista nem o .xlsx, que é o motivo
-- de o campo existir. A mesma RPC alimenta a tela e a exportação, então um
-- remendo só cobre as duas.
--
-- Diferente de `units`, aqui NÃO há tolerância a nulo: pedir "Setor = Logística"
-- e receber junto todas as ações sem setor esvaziaria o filtro. Ação antiga
-- (sem classificação) simplesmente fica de fora quando o filtro está ligado.
--
-- Filtro por ID, e não por nome como pilar/bloco/item: setor não tem coluna
-- legada em `actions`, então não existe o caso "nome que sobrou de importação
-- antiga" que obrigou os outros a casarem por texto.
--
-- O corpo é remendado a partir do banco (molde da 20260807162000): a função é
-- longa e uma cópia à mão perderia linha em silêncio.
do $do$
declare
  v_def text;
  v_new text;

  c_decl_velha constant text := $q$    case when jsonb_typeof(p_filters->'units') = 'array'$q$;
  c_decl_nova constant text := $q$    case when jsonb_typeof(p_filters->'dept') = 'array'
      then (select array_agg(v::uuid) from jsonb_array_elements_text(p_filters->'dept') v) end as dept,
    case when jsonb_typeof(p_filters->'sub') = 'array'
      then (select array_agg(v::uuid) from jsonb_array_elements_text(p_filters->'sub') v) end as sub,
    case when jsonb_typeof(p_filters->'units') = 'array'$q$;

  c_where_velha constant text := $q$    and (f.units is null or a.unit_id is null or a.unit_id = any(f.units))$q$;
  c_where_nova constant text := $q$    and (f.units is null or a.unit_id is null or a.unit_id = any(f.units))
    and (f.dept is null or a.department_id = any(f.dept))
    and (f.sub is null or a.subdepartment_id = any(f.sub))$q$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'search_action_ids';

  if (length(v_def) - length(replace(v_def, c_decl_velha, ''))) / length(c_decl_velha) <> 1
     or (length(v_def) - length(replace(v_def, c_where_velha, ''))) / length(c_where_velha) <> 1 then
    raise exception 'search_action_ids: trechos esperados não estão exatamente uma vez no corpo';
  end if;

  v_new := replace(v_def, c_decl_velha, c_decl_nova);
  v_new := replace(v_new, c_where_velha, c_where_nova);
  execute v_new;
end
$do$;

revoke execute on function public.search_action_ids(jsonb, integer, integer) from public, anon;
grant execute on function public.search_action_ids(jsonb, integer, integer) to authenticated;
