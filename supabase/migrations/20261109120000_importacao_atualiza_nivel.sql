-- ---------------------------------------------------------------------------
-- Importação de colaboradores: o "Perfil Função" (nível do cargo) passa a
-- valer também para quem já está cadastrado.
--
-- Até aqui a planilha só alcançava, num cadastro existente, gestor, perfil de
-- acesso e hierarquia (e o desligamento). O nível só era gravado na criação:
-- 284 dos 310 ativos estavam sem nível embora a planilha trouxesse o de 260
-- (LUIZ, 09/11/2026; os níveis foram aplicados à parte no mesmo dia).
--
-- Regras:
--   - célula vazia não apaga o nível de ninguém (como gestor e hierarquia)
--   - nível que nunca foi informado é PREENCHIMENTO, não movimentação: a
--     vigência aberta do histórico recebe o nível antes do cadastro, e o
--     trigger de movimentação não abre vigência nova por isso
--   - trocar um nível que já existia é movimentação, com vigência nova
--   - o nome do nível casa sem caixa e sem acento ("Junior" = "JUNIOR"), para
--     a planilha não criar de novo a duplicata "Júnior"/"JUNIOR" que existiu
--   - o resultado devolve `levels` e `levelsList`, como as outras três
--
-- As trocas são feitas sobre a definição em vigor, como em 20261106160000, e
-- falham alto se algum trecho esperado não estiver lá.
-- ---------------------------------------------------------------------------

do $do$
declare
  v_def text;
  v_novo text;
begin
  v_def := pg_get_functiondef('public.admin_import_employees(jsonb, text)'::regprocedure);
  v_novo := v_def;

  -- 1) variáveis
  if strpos(v_novo, 'v_hier uuid; v_hier_given boolean; v_hier_name text; v_cur_hier uuid; v_hier_label text;') = 0 then
    raise exception 'trecho 1 não encontrado';
  end if;
  v_novo := replace(v_novo,
    'v_hier uuid; v_hier_given boolean; v_hier_name text; v_cur_hier uuid; v_hier_label text;',
    'v_hier uuid; v_hier_given boolean; v_hier_name text; v_cur_hier uuid; v_hier_label text;
  v_lvl_given boolean; v_lvl_label text; v_levels int := 0; v_levels_list jsonb := ''[]''::jsonb;');

  -- 2) o nível da linha: casa sem caixa/acento e marca se a planilha disse algo
  if strpos(v_novo, $q$      v_lvl := null; v_name := nullif(trim(r->>'level'), '');
      if v_name is not null and length(v_name) <= 40 then
        select id into v_lvl from public.position_levels where tenant_id = v_tenant and name = v_name;
        if not found then insert into public.position_levels(tenant_id, name) values (v_tenant, v_name) returning id into v_lvl; end if;
      end if;$q$) = 0 then
    raise exception 'trecho 2 não encontrado';
  end if;
  v_novo := replace(v_novo, $q$      v_lvl := null; v_name := nullif(trim(r->>'level'), '');
      if v_name is not null and length(v_name) <= 40 then
        select id into v_lvl from public.position_levels where tenant_id = v_tenant and name = v_name;
        if not found then insert into public.position_levels(tenant_id, name) values (v_tenant, v_name) returning id into v_lvl; end if;
      end if;$q$, $q$      v_lvl := null; v_lvl_label := null; v_name := nullif(trim(r->>'level'), '');
      if v_name is not null and length(v_name) <= 40 then
        -- sem caixa e sem acento: "Junior" é o JUNIOR que já existe
        select id, name into v_lvl, v_lvl_label from public.position_levels
         where tenant_id = v_tenant and lower(unaccent(name)) = lower(unaccent(v_name))
         order by name limit 1;
        if v_lvl is null then
          insert into public.position_levels(tenant_id, name) values (v_tenant, v_name)
          returning id, name into v_lvl, v_lvl_label;
        end if;
      end if;
      -- vazio não apaga o nível de quem já tem (como gestor e hierarquia)
      v_lvl_given := v_lvl is not null;$q$);

  -- 3) cadastro existente: o nível entra na condição e no UPDATE
  if strpos(v_novo, $q$          if (v_mgr_given and v_cur_mgr is distinct from v_mgr)
             or (v_role_given and v_cur_role is distinct from v_role)
             or (v_hier_given and v_cur_hier is distinct from v_hier) then

            update public.memberships set
              manager_id = case when v_mgr_given then v_mgr else manager_id end,
              role = case when v_role_given then v_role else role end,
              hierarchy_level_id = case when v_hier_given then v_hier else hierarchy_level_id end
            where id = v_existing_mid;$q$) = 0 then
    raise exception 'trecho 3 não encontrado';
  end if;
  v_novo := replace(v_novo, $q$          if (v_mgr_given and v_cur_mgr is distinct from v_mgr)
             or (v_role_given and v_cur_role is distinct from v_role)
             or (v_hier_given and v_cur_hier is distinct from v_hier) then

            update public.memberships set
              manager_id = case when v_mgr_given then v_mgr else manager_id end,
              role = case when v_role_given then v_role else role end,
              hierarchy_level_id = case when v_hier_given then v_hier else hierarchy_level_id end
            where id = v_existing_mid;$q$, $q$          if (v_mgr_given and v_cur_mgr is distinct from v_mgr)
             or (v_role_given and v_cur_role is distinct from v_role)
             or (v_hier_given and v_cur_hier is distinct from v_hier)
             or (v_lvl_given and v_ex_lvl is distinct from v_lvl) then

            -- nível que nunca foi informado é preenchimento, não movimentação:
            -- a vigência aberta recebe o nível antes do cadastro
            if v_lvl_given and v_ex_lvl is null then
              update public.membership_history set position_level_id = v_lvl
               where membership_id = v_existing_mid and effective_to is null and position_level_id is null;
            end if;

            update public.memberships set
              manager_id = case when v_mgr_given then v_mgr else manager_id end,
              role = case when v_role_given then v_role else role end,
              hierarchy_level_id = case when v_hier_given then v_hier else hierarchy_level_id end,
              position_level_id = case when v_lvl_given then v_lvl else position_level_id end
            where id = v_existing_mid;$q$);

  -- 4) contagem e lista do que mudou de nível
  if strpos(v_novo, $q$                'motivo', case when v_hier is null then 'Hierarquia removida'
                               else 'Hierarquia: ' || coalesce(v_hier_label, '?') end);
            end if;
          end if;$q$) = 0 then
    raise exception 'trecho 4 não encontrado';
  end if;
  v_novo := replace(v_novo, $q$                'motivo', case when v_hier is null then 'Hierarquia removida'
                               else 'Hierarquia: ' || coalesce(v_hier_label, '?') end);
            end if;
          end if;$q$, $q$                'motivo', case when v_hier is null then 'Hierarquia removida'
                               else 'Hierarquia: ' || coalesce(v_hier_label, '?') end);
            end if;
            if v_lvl_given and v_ex_lvl is distinct from v_lvl then
              v_levels := v_levels + 1;
              v_levels_list := v_levels_list || jsonb_build_object(
                'nome', trim(r->>'full_name'), 'cpf', v_cpf,
                'motivo', 'Nível: ' || coalesce(v_lvl_label, '?'));
            end if;
          end if;$q$);

  -- 5) "nada a mudar" passa a considerar o nível
  if strpos(v_novo, $q$             and not (v_hier_given and v_cur_hier is distinct from v_hier)
             and not (v_dismissed is not null and v_ex_dis is distinct from v_dismissed) then$q$) = 0 then
    raise exception 'trecho 5 não encontrado';
  end if;
  v_novo := replace(v_novo, $q$             and not (v_hier_given and v_cur_hier is distinct from v_hier)
             and not (v_dismissed is not null and v_ex_dis is distinct from v_dismissed) then$q$, $q$             and not (v_hier_given and v_cur_hier is distinct from v_hier)
             and not (v_lvl_given and v_ex_lvl is distinct from v_lvl)
             and not (v_dismissed is not null and v_ex_dis is distinct from v_dismissed) then$q$);

  -- 6) o resultado
  if strpos(v_novo, $q$    'managers', v_managers, 'roles', v_roles, 'hierarchies', v_hiers,$q$) = 0 then
    raise exception 'trecho 6 não encontrado';
  end if;
  v_novo := replace(v_novo, $q$    'managers', v_managers, 'roles', v_roles, 'hierarchies', v_hiers,$q$,
    $q$    'managers', v_managers, 'roles', v_roles, 'hierarchies', v_hiers, 'levels', v_levels,
    'levelsList', v_levels_list,$q$);

  execute v_novo;
end
$do$;

revoke execute on function public.admin_import_employees(jsonb, text) from public, anon;
