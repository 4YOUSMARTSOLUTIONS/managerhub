-- A planilha passa a desligar quem já está cadastrado.
--
-- `admin_import_employees` tem três caminhos para alguém que já existe, e só
-- dois escreviam o desligamento: pessoa nova, e mesma pessoa com matrícula
-- diferente (recontratação). No terceiro, mesma pessoa com a MESMA matrícula, o
-- comentário diz "o cadastro NÃO é reescrito: a planilha alcança gestor, perfil
-- e hierarquia". A regra é boa, ela impede que uma planilha ruim apague dado
-- curado na tela, mas abriu um buraco justamente no fato que só o RH tem e que
-- o sistema não descobre sozinho: a saída da pessoa.
--
-- Sintoma: colaborador com data de demissão na planilha seguia Ativo no
-- cadastro, com `dismissed_at` nulo, porque a linha dele caía nesse terceiro
-- caminho.
--
-- ASSIMETRIA DELIBERADA: data preenchida DESLIGA; data vazia NÃO reativa
-- ninguém. É o mesmo cuidado que o resto da rotina já tem com `coalesce`, e
-- sem ele uma planilha só de ativos ressuscitaria meio quadro em silêncio.
--
-- Entra junto o `skip_if_new`, que a tela manda por linha: desligado que ainda
-- NÃO existe não vira cadastro novo quando a caixa "Importar apenas ativos"
-- está marcada. Antes a tela resolvia isso jogando a linha fora antes de
-- enviar, e era isso que também engolia a baixa de quem já existia.
--
-- Remendo a partir do banco, e não reescrita à mão: a função tem ~300 linhas,
-- resolve matrícula, unidade, gestor, perfil e hierarquia, e já foi ajustada
-- antes. Reescrevê-la inteira para mudar três trechos arriscaria desfazer em
-- silêncio algum ajuste que ela tenha recebido.
do $do$
declare
  v_def text;

  -- 1) desligamento no caminho de mesma matrícula
  c1_de constant text := $q$          -- Mesmo código: o cadastro NÃO é reescrito. A planilha alcança três
          -- coisas aqui, gestor, perfil e hierarquia, e só se tiver dito algo.
          if (v_mgr_given and v_cur_mgr is distinct from v_mgr)$q$;
  c1_para constant text := $q$          -- O DESLIGAMENTO PASSA, mesmo com a matrícula igual: é o único fato
          -- aqui que só a folha conhece. Data preenchida desliga; data vazia
          -- não reativa ninguém.
          if v_dismissed is not null and v_ex_dis is distinct from v_dismissed then
            update public.memberships
               set dismissed_at = v_dismissed, is_active = false
             where id = v_existing_mid;
            v_updated := v_updated + 1;
            v_updated_list := v_updated_list || jsonb_build_object(
              'nome', trim(r->>'full_name'), 'cpf', v_cpf,
              'motivo', 'Desligado em ' || to_char(v_dismissed, 'DD/MM/YYYY') || ' pela planilha');
          end if;

          -- Fora o desligamento, o cadastro NÃO é reescrito. A planilha alcança
          -- três coisas aqui, gestor, perfil e hierarquia, e só se tiver dito algo.
          if (v_mgr_given and v_cur_mgr is distinct from v_mgr)$q$;

  -- 2) "nada a mudar" não pode mais valer quando o desligamento mudou
  c2_de constant text := $q$          elsif not (v_mgr_given and v_cur_mgr is distinct from v_mgr)
             and not (v_role_given and v_cur_role is distinct from v_role)
             and not (v_hier_given and v_cur_hier is distinct from v_hier) then$q$;
  c2_para constant text := $q$          elsif not (v_mgr_given and v_cur_mgr is distinct from v_mgr)
             and not (v_role_given and v_cur_role is distinct from v_role)
             and not (v_hier_given and v_cur_hier is distinct from v_hier)
             and not (v_dismissed is not null and v_ex_dis is distinct from v_dismissed) then$q$;

  -- 3) desligado que ainda não existe não vira cadastro novo
  c3_de constant text := $q$      else
        v_auth_email := coalesce(v_email, v_cpf || '@cpf.managerhub.local');$q$;
  c3_para constant text := $q$      else
        -- Desligado que ainda NÃO existe: a tela pediu para não criar. Vira
        -- linha de "ignorado" com o motivo escrito, e não sumiço silencioso.
        if coalesce(r->>'skip_if_new', '') <> '' and v_dismissed is not null then
          v_skipped := v_skipped + 1;
          v_skipped_list := v_skipped_list || jsonb_build_object(
            'nome', trim(r->>'full_name'), 'cpf', v_cpf, 'codigo', v_code,
            'motivo', 'Já desligado e sem cadastro: não foi criado. Desmarque "Importar apenas ativos" para trazer o histórico.');
          continue;
        end if;

        v_auth_email := coalesce(v_email, v_cpf || '@cpf.managerhub.local');$q$;

  procura text[];
  troca   text[];
  i integer;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_import_employees';

  if v_def is null then
    raise exception 'admin_import_employees não encontrada';
  end if;

  procura := array[c1_de, c2_de, c3_de];
  troca   := array[c1_para, c2_para, c3_para];

  for i in 1 .. array_length(procura, 1) loop
    if (length(v_def) - length(replace(v_def, procura[i], ''))) / length(procura[i]) <> 1 then
      raise exception 'trecho % não está exatamente uma vez no corpo de admin_import_employees', i;
    end if;
    v_def := replace(v_def, procura[i], troca[i]);
  end loop;

  execute v_def;
end
$do$;

-- O `create or replace` devolve os privilégios padrão: revogar de novo.
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
