-- Importação de colaboradores: o gestor é achado por UNIDADE + MATRÍCULA, nunca por nome.
--
-- Três defeitos fechados de uma vez, todos no mesmo lugar
-- (`admin_import_employees`):
--
-- 1. O Código Gestor era buscado com `select ... into` sem tratar duplicata:
--    com a mesma matrícula em duas unidades, o Postgres escolhia UMA linha em
--    silêncio, e o subordinado podia ser pendurado no gestor errado.
-- 2. A coluna legada "Gestor" ainda caía para casamento por NOME inteiro, e
--    casamento por nome foi abolido por decisão de produto: nome permite erro
--    (typo, homônimo), identificador não.
-- 3. A mesma coluna também tentava matrícula sem tratar duplicata.
--
-- A regra nova: todos os donos da matrícula são coletados; em empresa com UMA
-- unidade, um dono resolve; em empresa MULTIUNIDADE o pool é filtrado pela
-- unidade da própria linha (a coluna Empresa), e só resolve o que sobrar
-- exatamente um. Sem desempate, a linha vira ERRO nominal orientando o CPF, a
-- não ser que a coluna Gestor traga o CPF, que aí decide (CPF é identificador,
-- não nome).
--
-- O corpo é remendado a partir do que está no banco (molde da 20260810140000):
-- a função tem centenas de linhas e uma cópia à mão perderia alguma em
-- silêncio. Cada trecho é verificado como ÚNICO antes do replace.
do $do$
declare
  v_def text;
  v_new text;

  c_decl_velha constant text := $q$v_mgr_digits text; v_mgr_n int; v_cur_mgr uuid; v_mgr_name text;$q$;
  c_decl_nova constant text := $q$v_mgr_digits text; v_mgr_n int; v_cur_mgr uuid; v_mgr_name text; v_mgr_pool uuid[]; v_mgr_filtro uuid[];$q$;

  c_codigo_velho constant text := $q$        if v_mgr_code is not null then
          select m2.user_id into v_mgr from public.memberships m2
           where m2.tenant_id = v_tenant and m2.employee_code = v_mgr_code;
        end if;$q$;
  c_codigo_novo constant text := $q$        if v_mgr_code is not null then
          -- unidades da LINHA (a mesma leitura roda de novo mais abaixo; repetir é inócuo)
          v_unit_names := '{}';
          if jsonb_typeof(r->'units') = 'array' then
            select array_agg(trim(x)) into v_unit_names from jsonb_array_elements_text(r->'units') as x where nullif(trim(x), '') is not null;
          elsif nullif(trim(r->>'unit'), '') is not null then
            select array_agg(trim(x)) into v_unit_names from regexp_split_to_table(r->>'unit', '[;,/]') as x where nullif(trim(x), '') is not null;
          end if;
          -- TODOS os donos da matrícula: nunca escolher um em silêncio
          select array_agg(m2.user_id) into v_mgr_pool from public.memberships m2
           where m2.tenant_id = v_tenant and m2.employee_code = v_mgr_code;
          if (select count(*) from public.units u where u.tenant_id = v_tenant) > 1 then
            -- empresa multiunidade: o casamento é por unidade + matrícula, e a
            -- unidade é a da linha do subordinado
            select array_agg(distinct m2.user_id) into v_mgr_filtro
              from public.memberships m2
              join public.membership_units mu on mu.membership_id = m2.id
              join public.units u on u.id = mu.unit_id
             where m2.tenant_id = v_tenant
               and m2.user_id = any(coalesce(v_mgr_pool, '{}'))
               and lower(unaccent(u.name)) = any(select lower(unaccent(x)) from unnest(coalesce(v_unit_names, '{}')) as x);
            v_mgr_pool := v_mgr_filtro;
          end if;
          if coalesce(array_length(v_mgr_pool, 1), 0) = 1 then
            v_mgr := v_mgr_pool[1];
          elsif v_mgr_ref is null then
            v_errors := v_errors || jsonb_build_object('nome', trim(r->>'full_name'), 'cpf', v_cpf,
              'erro', 'Código Gestor "' || v_mgr_code || '" não encontrado ou não resolve pela unidade da linha. Use o CPF do gestor na coluna Gestor.');
            continue;
          end if;
        end if;$q$;

  c_ref_codigo_velho constant text := $q$          if v_mgr is null then
            select m2.user_id into v_mgr from public.memberships m2
             where m2.tenant_id = v_tenant and m2.employee_code = v_mgr_ref;
          end if;
$q$;

  c_ref_nome_velho constant text := $q$          if v_mgr is null then
            select count(*) into v_mgr_n
              from public.memberships m2 join public.profiles p2 on p2.id = m2.user_id
             where m2.tenant_id = v_tenant and lower(trim(p2.full_name)) = lower(v_mgr_ref);
            if v_mgr_n > 1 then
              v_errors := v_errors || jsonb_build_object('nome', trim(r->>'full_name'), 'cpf', v_cpf,
                'erro', 'Gestor ambíguo: mais de um colaborador chamado "' || v_mgr_ref || '". Use a matrícula na coluna Código Gestor.');
              continue;
            elsif v_mgr_n = 1 then
              select m2.user_id into v_mgr
                from public.memberships m2 join public.profiles p2 on p2.id = m2.user_id
               where m2.tenant_id = v_tenant and lower(trim(p2.full_name)) = lower(v_mgr_ref);
            end if;
          end if;
$q$;

  c_naoach_velho constant text := $q$'erro', 'Gestor não encontrado nesta empresa: "' || coalesce(v_mgr_code, v_mgr_ref) || '"');$q$;
  c_naoach_novo constant text := $q$'erro', 'Gestor não encontrado nesta empresa: "' || coalesce(v_mgr_code, v_mgr_ref) || '". Use a matrícula no Código Gestor ou o CPF na coluna Gestor; nome não identifica.');$q$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_import_employees';

  if (length(v_def) - length(replace(v_def, c_decl_velha, ''))) / length(c_decl_velha) <> 1
     or (length(v_def) - length(replace(v_def, c_codigo_velho, ''))) / length(c_codigo_velho) <> 1
     or (length(v_def) - length(replace(v_def, c_ref_codigo_velho, ''))) / length(c_ref_codigo_velho) <> 1
     or (length(v_def) - length(replace(v_def, c_ref_nome_velho, ''))) / length(c_ref_nome_velho) <> 1
     or (length(v_def) - length(replace(v_def, c_naoach_velho, ''))) / length(c_naoach_velho) <> 1 then
    raise exception 'admin_import_employees: trechos esperados não estão exatamente uma vez no corpo';
  end if;

  v_new := replace(v_def, c_decl_velha, c_decl_nova);
  v_new := replace(v_new, c_codigo_velho, c_codigo_novo);
  -- a coluna Gestor passa a aceitar SÓ CPF: os caminhos por matrícula solta e
  -- por NOME saem inteiros
  v_new := replace(v_new, c_ref_codigo_velho, '');
  v_new := replace(v_new, c_ref_nome_velho, '');
  v_new := replace(v_new, c_naoach_velho, c_naoach_novo);

  execute v_new;
end
$do$;

revoke execute on function public.admin_import_employees(jsonb, text) from public, anon;
