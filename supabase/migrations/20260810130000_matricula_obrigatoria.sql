-- Matrícula obrigatória, como o CPF: são os dois identificadores do colaborador.
--
-- A matrícula virou chave das importações (férias, punições, RV) e do vínculo
-- com o gestor na planilha de colaboradores; um cadastro sem ela fica invisível
-- para esses casamentos. A obrigatoriedade vive nas RPCs, que são o único
-- caminho de escrita do cadastro, e não em NOT NULL na coluna: há linhas
-- antigas sem matrícula, e elas passam a ser corrigidas na PRÓXIMA edição da
-- ficha, sem quebrar o que já existe.
--
-- Os corpos são remendados a partir do que está no banco (molde da
-- 20260807162000): as funções são grandes e uma cópia à mão seria a chance de
-- perder alguma linha em silêncio.
do $do$
declare
  fn text;
  v_def text;
  v_new text;
begin
  foreach fn in array array['admin_create_employee', 'admin_update_employee'] loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = fn;

    v_new := replace(
      v_def,
      $q$if v_cpf is null or v_cpf !~ '^[0-9]{11}$' then raise exception 'CPF inválido'; end if;$q$,
      $q$if v_cpf is null or v_cpf !~ '^[0-9]{11}$' then raise exception 'CPF inválido'; end if;
  if nullif(trim(p_data->>'employee_code'), '') is null then raise exception 'Matrícula obrigatória'; end if;$q$
    );
    if v_new = v_def then
      raise exception 'trecho do CPF não encontrado em %', fn;
    end if;
    execute v_new;
  end loop;
end
$do$;

-- Importação em lote: linha sem matrícula vira ERRO nominal no resumo, com o
-- nome de quem ficou de fora, em vez de criar cadastro sem matrícula.
do $do$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_import_employees';

  v_new := replace(
    v_def,
    $q$v_code := nullif(trim(r->>'employee_code'), '');$q$,
    $q$v_code := nullif(trim(r->>'employee_code'), '');
      if v_code is null then
        v_errors := v_errors || jsonb_build_object('nome', r->>'full_name', 'cpf', v_cpf, 'erro', 'Matrícula vazia'); continue;
      end if;$q$
  );
  if v_new = v_def then
    raise exception 'trecho da matrícula não encontrado em admin_import_employees';
  end if;

  execute v_new;
end
$do$;

revoke execute on function public.admin_create_employee(jsonb, text) from public, anon;
revoke execute on function public.admin_update_employee(uuid, jsonb) from public, anon;
revoke execute on function public.admin_import_employees(jsonb, text) from public, anon;
