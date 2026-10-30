-- Férias: as mensagens do banco deixam de falar em "relatório da folha".
--
-- A importação de períodos aquisitivos passou a aceitar o modelo do
-- MANAGERHUB, além do relatório da folha da Cervantes. Uma empresa que importa
-- pelo modelo não reconheceria "o último relatório importado da folha" como o
-- arquivo que ela mesma subiu. Só o texto muda; a regra é a mesma.
--
-- Troca cirúrgica no corpo atual (pg_get_functiondef + replace), com a
-- conferência de que cada trecho existe exatamente uma vez.

do $$
declare
  v_def text;
  v_antigo text;
  v_novo text;
begin
  -- trava do registro direto
  v_def := pg_get_functiondef('public.guard_ferias_registro_direto()'::regprocedure);
  v_antigo := 'que confere o saldo e o prazo da folha. O registro direto aceita apenas férias anteriores ao último relatório importado da folha.';
  v_novo := 'que confere o saldo e o prazo. O registro direto aceita apenas férias anteriores à última importação de períodos aquisitivos.';
  if (length(v_def) - length(replace(v_def, v_antigo, ''))) / length(v_antigo) <> 1 then
    raise exception 'trecho da trava do registro direto não encontrado uma única vez';
  end if;
  execute replace(v_def, v_antigo, v_novo);

  -- validação: quem não veio na importação
  v_def := pg_get_functiondef('public.ferias_validar_periodos(uuid, uuid, jsonb, date, uuid, boolean)'::regprocedure);
  v_antigo := 'ainda não foram carregados da folha de pagamento, então o saldo não pode ser conferido.';
  v_novo := 'ainda não foram importados, então o saldo não pode ser conferido.';
  if (length(v_def) - length(replace(v_def, v_antigo, ''))) / length(v_antigo) <> 1 then
    raise exception 'trecho da validação não encontrado uma única vez';
  end if;
  execute replace(v_def, v_antigo, v_novo);

  -- importação: a guarda de papel
  v_def := pg_get_functiondef('public.ferias_importar_aquisitivos(uuid, date, date, text, jsonb, jsonb)'::regprocedure);
  v_antigo := 'importa os períodos aquisitivos da folha.';
  v_novo := 'importa os períodos aquisitivos.';
  if (length(v_def) - length(replace(v_def, v_antigo, ''))) / length(v_antigo) <> 1 then
    raise exception 'trecho da importação não encontrado uma única vez';
  end if;
  execute replace(v_def, v_antigo, v_novo);
end $$;

revoke execute on function public.guard_ferias_registro_direto() from public, anon, authenticated;
revoke execute on function public.ferias_validar_periodos(uuid, uuid, jsonb, date, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.ferias_importar_aquisitivos(uuid, date, date, text, jsonb, jsonb) from public, anon;

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
