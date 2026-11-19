-- "RH" vira "DP" nos textos que o banco devolve (LUIZ, 19/11/2026): mensagens
-- de erro, avisos do sino e a coluna Situação do relatório de absenteísmo
-- ("Aguardando o DP"; o app mapeia esse texto de volta para o status, em
-- src/lib/actions/absenteismos.ts, e muda junto).
--
-- Só o texto muda: nenhuma regra. A troca é da palavra inteira, maiúscula, e
-- a marca continua `is_hr` (a pessoa do Departamento Pessoal). Na importação
-- de colaboradores, a opção da ficha agora se chama "Departamento Pessoal".

do $$
declare
  v record;
  v_def text;
  v_novo text;
begin
  for v in
    select p.oid, p.oid::regprocedure as assinatura, p.prosecdef
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'absenteismo_alcance_das_regras', 'absenteismo_cancelar', 'absenteismo_confirmar',
         'absenteismo_decidir', 'absenteismo_encerrar_falta', 'absenteismo_lembrar_em_aberto',
         'absenteismo_lembrar_faltas_sem_termino', 'absenteismo_relatorio', 'admin_import_employees',
         'colaborador_definir_desligamento', 'guard_absenteismo_atestado', 'guard_absenteismo_lancamento',
         'guard_punicao_lancamento', 'punicao_decidir', 'punicao_submeter', 'rh_nao_define_papel',
         'so_administracao_concede_rh')
  loop
    v_def := pg_get_functiondef(v.oid);
    -- a importação: quem escreve "DP" na coluna Perfil recebe a mesma recusa de
    -- quem escreve "RH" (a marca se dá na ficha, não pela planilha)
    v_novo := replace(v_def,
      $q$if v_role_txt in ('rh', 'hr', 'recursos humanos') then$q$,
      $q$if v_role_txt in ('rh', 'hr', 'recursos humanos', 'dp', 'departamento pessoal') then$q$);
    v_novo := replace(v_novo,
      'RH não é perfil. Use Gestor, Gerencial ou Funcionário e marque a opção RH no cadastro do colaborador.',
      'Departamento Pessoal não é perfil. Use Gestor, Gerencial ou Funcionário e marque a opção Departamento Pessoal no cadastro do colaborador.');
    v_novo := regexp_replace(v_novo, '\mRH\M', 'DP', 'g');
    if v_novo = v_def then
      raise exception 'nada a trocar em %', v.assinatura;
    end if;
    execute v_novo;
    -- regra do projeto para toda SECURITY DEFINER tocada (o ACL de cada uma já
    -- estava assim; isto só reafirma)
    if v.prosecdef then
      execute format('revoke execute on function %s from public, anon', v.assinatura);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
