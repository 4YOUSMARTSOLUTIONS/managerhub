-- A importação em lote passa a valer para o RH.
--
-- `admin_create_employee` e `admin_update_employee` já aceitam `hr` desde que o
-- papel foi criado (20260807161000): o departamento pessoal cadastra e corrige
-- colaborador. Só a importação em lote tinha ficado em owner/admin, sem motivo
-- declarado: é a mesma alçada, em escala.
--
-- O QUE NÃO VEM JUNTO É O PERFIL DE ACESSO. A coluna Perfil fica inerte quando
-- quem importa é o RH, igual à tela, onde ele não tem o campo. A trava de
-- verdade continua sendo o trigger `rh_nao_define_papel`, que vale para
-- qualquer caminho; aqui a coluna é zerada antes para o RH não receber uma
-- enxurrada de linhas com erro de permissão por algo que ele não deveria estar
-- preenchendo.
do $do$
declare
  v_def text;

  c1_de constant text := $q$  v_hash text;$q$;
  c1_para constant text := $q$  v_hash text;
  v_pode_papel boolean;$q$;

  c2_de constant text := $q$  if v_tenant is null or not public.has_tenant_role(v_tenant, array['owner','admin']::member_role[]) then
    raise exception 'Sem permissão';
  end if;$q$;
  c2_para constant text := $q$  if v_tenant is null or not public.has_tenant_role(v_tenant, array['owner','admin','hr']::member_role[]) then
    raise exception 'Sem permissão';
  end if;
  -- quem define perfil de acesso é a administração; o RH cadastra
  v_pode_papel := public.has_tenant_role(v_tenant, array['owner','admin']::member_role[]);$q$;

  c3_de constant text := $q$      v_role_txt := lower(unaccent(coalesce(trim(r->>'role'), '')));$q$;
  c3_para constant text := $q$      v_role_txt := case when v_pode_papel
                        then lower(unaccent(coalesce(trim(r->>'role'), ''))) else '' end;$q$;

  procura text[];
  troca   text[];
  i integer;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_import_employees';
  if v_def is null then raise exception 'admin_import_employees nao encontrada'; end if;

  procura := array[c1_de, c2_de, c3_de];
  troca   := array[c1_para, c2_para, c3_para];

  for i in 1 .. array_length(procura, 1) loop
    if (length(v_def) - length(replace(v_def, procura[i], ''))) / length(procura[i]) <> 1 then
      raise exception 'trecho % nao esta exatamente uma vez no corpo de admin_import_employees', i;
    end if;
    v_def := replace(v_def, procura[i], troca[i]);
  end loop;

  execute v_def;
end
$do$;

revoke execute on function public.admin_import_employees(jsonb, text) from public, anon;

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception 'ha % funcoes SECURITY DEFINER alcancaveis por anon', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
