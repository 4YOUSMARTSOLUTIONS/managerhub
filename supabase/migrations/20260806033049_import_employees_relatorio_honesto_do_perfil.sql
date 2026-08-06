-- O relatório da importação mentia: depois da correção anterior, a linha que só
-- mudava e-mail/telefone/nascimento/sexo era gravada, mas voltava contada como
-- "Já cadastrado, nada a mudar".
--
-- Depois de uma importação que não gravou nada e não avisou, um resumo que diz
-- "nada a mudar" enquanto muda é exatamente o sinal que não pode ficar.
--
-- Agora o próprio UPDATE decide: o `is distinct from` faz a linha só ser tocada
-- se algum campo do perfil realmente difere, e o `found` diz qual contador somar.
-- Resultado: reimportar a mesma planilha duas vezes conta 3 atualizados na
-- primeira e 3 ignorados na segunda, que é o que a pessoa espera ler.
do $outer$
declare
  src text; antes text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_import_employees';

  alvo := E'          else\n'
       || E'            v_skipped := v_skipped + 1;\n'
       || E'            v_skipped_list := v_skipped_list || jsonb_build_object(\n'
       || E'              ''nome'', trim(r->>''full_name''), ''cpf'', v_cpf, ''codigo'', v_existing_code,\n'
       || E'              ''motivo'', case when v_mgr_given or v_role_given or v_hier_given then ''Já cadastrado, nada a mudar''\n'
       || E'                             else ''Já cadastrado com o mesmo código'' end);\n'
       || E'          end if;\n'
       || E'          update public.profiles set\n'
       || E'            full_name = trim(r->>''full_name''),\n'
       || E'            email = coalesce(v_email, email),\n'
       || E'            phone = coalesce(nullif(trim(r->>''phone''), ''''), phone),\n'
       || E'            birth_date = coalesce(public.parse_br_date(r->>''birth_date''), birth_date),\n'
       || E'            gender = v_gender\n'
       || E'          where id = v_existing_uid;\n';

  novo := E'          end if;\n'
       || E'\n'
       || E'          update public.profiles set\n'
       || E'            full_name = trim(r->>''full_name''),\n'
       || E'            email = coalesce(v_email, email),\n'
       || E'            phone = coalesce(nullif(trim(r->>''phone''), ''''), phone),\n'
       || E'            birth_date = coalesce(public.parse_br_date(r->>''birth_date''), birth_date),\n'
       || E'            gender = v_gender\n'
       || E'          where id = v_existing_uid\n'
       || E'            and (full_name, email, phone, birth_date, gender) is distinct from (\n'
       || E'              trim(r->>''full_name''),\n'
       || E'              coalesce(v_email, email),\n'
       || E'              coalesce(nullif(trim(r->>''phone''), ''''), phone),\n'
       || E'              coalesce(public.parse_br_date(r->>''birth_date''), birth_date),\n'
       || E'              v_gender);\n'
       || E'\n'
       || E'          if found then\n'
       || E'            v_updated := v_updated + 1;\n'
       || E'            v_updated_list := v_updated_list || jsonb_build_object(\n'
       || E'              ''nome'', trim(r->>''full_name''), ''cpf'', v_cpf,\n'
       || E'              ''motivo'', ''Dados do cadastro atualizados (e-mail, telefone, nascimento ou sexo)'');\n'
       || E'          elsif not (v_mgr_given and v_cur_mgr is distinct from v_mgr)\n'
       || E'             and not (v_role_given and v_cur_role is distinct from v_role)\n'
       || E'             and not (v_hier_given and v_cur_hier is distinct from v_hier) then\n'
       || E'            v_skipped := v_skipped + 1;\n'
       || E'            v_skipped_list := v_skipped_list || jsonb_build_object(\n'
       || E'              ''nome'', trim(r->>''full_name''), ''cpf'', v_cpf, ''codigo'', v_existing_code,\n'
       || E'              ''motivo'', ''Já cadastrado, nada a mudar'');\n'
       || E'          end if;\n';

  antes := src; src := replace(src, alvo, novo);
  if src = antes then raise exception 'âncora do relatório não encontrada'; end if;

  execute src;
end $outer$;
