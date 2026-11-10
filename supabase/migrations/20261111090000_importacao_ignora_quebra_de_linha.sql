-- Importação de colaboradores: nome de setor, subsetor, função, nível e
-- hierarquia com quebra de linha ou espaço repetido (LUIZ, 10/11/2026).
--
-- Célula do Excel com Alt+Enter chega com "\n" ou "\r\n" no meio do nome. A
-- comparação era lower(unaccent(nome)), que ignora caixa e acento mas não a
-- quebra: "GERENTE DE EXCELENCIA\n OPERACIONAL" e "...\r\n OPERACIONAL"
-- viravam funções diferentes. A importação de 09/11 criou uma cópia e moveu a
-- pessoa para ela; a de 10/11 voltou para a original, registrando uma
-- movimentação de função que não houve (e a RV pesa a função pelos dias).
--
-- Agora o nome é limpo na entrada (espaços em branco de qualquer tipo viram um
-- espaço só) e a comparação usa a mesma limpeza dos dois lados, então nomes já
-- gravados com espaço duplo também casam.

create or replace function public.nome_limpo(p text)
returns text
language sql immutable set search_path to 'public'
as $$
  select nullif(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), '');
$$;

create or replace function public.nome_canonico(p text)
returns text
language sql stable set search_path to 'public', 'extensions'
as $$
  select lower(extensions.unaccent(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'))));
$$;

do $$
declare
  v_def text := pg_get_functiondef('public.admin_import_employees(jsonb,text,boolean)'::regprocedure);
begin
  -- entrada limpa: o que for criado no catálogo já nasce sem quebra nem espaço duplo
  v_def := replace(v_def, $q$v_name := nullif(trim(r->>'department'), '');$q$, $q$v_name := public.nome_limpo(r->>'department');$q$);
  v_def := replace(v_def, $q$v_name := nullif(trim(r->>'subdepartment'), '');$q$, $q$v_name := public.nome_limpo(r->>'subdepartment');$q$);
  v_def := replace(v_def, $q$v_name := nullif(trim(r->>'position'), '');$q$, $q$v_name := public.nome_limpo(r->>'position');$q$);
  v_def := replace(v_def, $q$v_name := nullif(trim(r->>'level'), '');$q$, $q$v_name := public.nome_limpo(r->>'level');$q$);
  v_def := replace(v_def, $q$v_hier_name := nullif(trim(r->>'hierarchy'), '');$q$, $q$v_hier_name := public.nome_limpo(r->>'hierarchy');$q$);
  -- comparação com a mesma limpeza dos dois lados
  v_def := replace(v_def, 'lower(unaccent(name)) = lower(unaccent(v_name))', 'public.nome_canonico(name) = public.nome_canonico(v_name)');
  v_def := replace(v_def, 'lower(unaccent(name)) = lower(unaccent(v_hier_name))', 'public.nome_canonico(name) = public.nome_canonico(v_hier_name)');

  -- falha alto se alguma âncora sumiu (a função mudou desde a leitura)
  if position('public.nome_limpo(r->>''department'')' in v_def) = 0
     or position('public.nome_limpo(r->>''subdepartment'')' in v_def) = 0
     or position('public.nome_limpo(r->>''position'')' in v_def) = 0
     or position('public.nome_limpo(r->>''level'')' in v_def) = 0
     or position('public.nome_limpo(r->>''hierarchy'')' in v_def) = 0
     or position('lower(unaccent(name)) = lower(unaccent(v_name))' in v_def) > 0
     or position('lower(unaccent(name)) = lower(unaccent(v_hier_name))' in v_def) > 0 then
    raise exception 'admin_import_employees mudou: âncoras da limpeza de nomes não encontradas';
  end if;
  execute v_def;
end $$;
revoke execute on function public.admin_import_employees(jsonb, text, boolean) from public, anon;

notify pgrst, 'reload schema';
