-- Importacao em lote passa a aceitar HIERARQUIA.
--
-- O ponto que faz isso funcionar: as 987 pessoas JA EXISTEM, entao toda linha da
-- planilha cai no ramo "mesmo codigo". Se a hierarquia nao entrasse ali, junto do
-- gestor e do perfil, o preenchimento em lote nao faria nada, que foi exatamente
-- o problema original da coluna de gestor.
--
-- Nivel que nao existe e CRIADO, como ja acontece com Setor e Funcao, e entra no
-- fim da ordem (maior rank + 10).

create or replace function public.admin_import_employees(p_rows jsonb, p_password text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant uuid := public.my_active_tenant();
  v_hash text;
  r jsonb;
  v_cpf text; v_email text; v_auth_email text; v_name text;
  v_dept uuid; v_sub uuid; v_pos uuid; v_lvl uuid; v_unit uuid;
  v_uid uuid; v_mid uuid; v_dismissed date; v_adm date;
  v_gender gender_type; v_kind unit_kind;
  v_unit_names text[];
  v_code text; v_existing_uid uuid; v_existing_mid uuid; v_existing_code text; v_existing_adm date;
  v_ex_dis date; v_ex_dept uuid; v_ex_sub uuid; v_ex_pos uuid; v_ex_lvl uuid;
  v_mgr uuid; v_mgr_given boolean; v_mgr_code text; v_mgr_ref text;
  v_mgr_digits text; v_mgr_n int; v_cur_mgr uuid; v_mgr_name text;
  v_role member_role; v_role_given boolean; v_role_txt text; v_cur_role member_role;
  v_hier uuid; v_hier_given boolean; v_hier_name text; v_cur_hier uuid; v_hier_label text;
  v_created int := 0; v_updated int := 0; v_skipped int := 0; v_archived int := 0;
  v_managers int := 0; v_roles int := 0; v_hiers int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_skipped_list jsonb := '[]'::jsonb;
  v_updated_list jsonb := '[]'::jsonb;
  v_managers_list jsonb := '[]'::jsonb;
  v_hiers_list jsonb := '[]'::jsonb;
  v_roles_list jsonb := '[]'::jsonb;
begin
  if v_tenant is null or not public.has_tenant_role(v_tenant, array['owner','admin']::member_role[]) then
    raise exception 'Sem permissão';
  end if;
  if p_password is null or length(p_password) < 8 then raise exception 'Senha padrão mínima de 8 caracteres'; end if;
  v_hash := crypt(p_password, gen_salt('bf'));

  for r in select value from jsonb_array_elements(p_rows) as t(value) loop
    begin
      v_mid := null;
      v_cpf := nullif(regexp_replace(coalesce(r->>'cpf', ''), '[^0-9]', '', 'g'), '');
      if v_cpf is null or v_cpf !~ '^[0-9]{11}$' then
        v_errors := v_errors || jsonb_build_object('nome', r->>'full_name', 'erro', 'CPF inválido'); continue;
      end if;
      if coalesce(trim(r->>'full_name'), '') = '' then
        v_errors := v_errors || jsonb_build_object('cpf', v_cpf, 'erro', 'Nome vazio'); continue;
      end if;

      v_code := nullif(trim(r->>'employee_code'), '');
      v_adm := public.parse_br_date(r->>'admission_date');
      v_dismissed := public.parse_br_date(r->>'dismissed_at');

      -- ---------------------------------------------------------------- perfil
      v_role := null; v_role_given := false;
      v_role_txt := lower(unaccent(coalesce(trim(r->>'role'), '')));
      if v_role_txt <> '' then
        v_role_given := true;
        v_role := case v_role_txt
                    when 'gestor' then 'team_lead'
                    when 'team_lead' then 'team_lead'
                    when 'gerencial' then 'manager'
                    when 'manager' then 'manager'
                    when 'funcionario' then 'member'
                    when 'membro' then 'member'
                    when 'member' then 'member'
                    else null end;
        if v_role is null then
          if v_role_txt in ('administrador', 'admin', 'proprietario', 'owner') then
            v_errors := v_errors || jsonb_build_object('nome', trim(r->>'full_name'), 'cpf', v_cpf,
              'erro', 'Perfil "' || trim(r->>'role') || '" não pode ser dado por planilha. Use a tela de colaboradores.');
          else
            v_errors := v_errors || jsonb_build_object('nome', trim(r->>'full_name'), 'cpf', v_cpf,
              'erro', 'Perfil desconhecido: "' || trim(r->>'role') || '". Use Gestor, Gerencial ou Funcionário.');
          end if;
          continue;
        end if;
      end if;

      -- ---------------------------------------------------------------- gestor
      -- ------------------------------------------------------------ hierarquia
      v_hier := null; v_hier_given := false; v_hier_label := null;
      v_hier_name := nullif(trim(r->>'hierarchy'), '');
      if v_hier_name is not null then
        v_hier_given := true;
        if lower(v_hier_name) in ('-', 'nenhum', 'sem hierarquia') then
          v_hier := null;
        else
          -- busca sem diferenciar caixa: o UNIQUE do banco e sensivel, entao
          -- "DIRETORIA" criaria um segundo nivel ao lado de "Diretoria"
          select id, name into v_hier, v_hier_label from public.hierarchy_levels
           where tenant_id = v_tenant and lower(name) = lower(v_hier_name);
          if v_hier is null then
            insert into public.hierarchy_levels (tenant_id, name, rank)
            values (v_tenant, v_hier_name,
                    coalesce((select max(rank) from public.hierarchy_levels where tenant_id = v_tenant), 0) + 10)
            returning id, name into v_hier, v_hier_label;
          end if;
        end if;
      end if;

      v_mgr := null; v_mgr_given := false; v_mgr_name := null;
      v_mgr_code := nullif(trim(r->>'manager_code'), '');
      v_mgr_ref  := nullif(trim(r->>'manager'), '');

      if lower(coalesce(v_mgr_code, v_mgr_ref, '')) in ('-', 'nenhum', 'sem gestor') then
        v_mgr_given := true; v_mgr := null;
      elsif v_mgr_code is not null or v_mgr_ref is not null then
        v_mgr_given := true;
        if v_mgr_code is not null then
          select m2.user_id into v_mgr from public.memberships m2
           where m2.tenant_id = v_tenant and m2.employee_code = v_mgr_code;
        end if;
        if v_mgr is null and v_mgr_ref is not null then
          v_mgr_digits := nullif(regexp_replace(v_mgr_ref, '[^0-9]', '', 'g'), '');
          if v_mgr_digits ~ '^[0-9]{11}$' then
            select p2.id into v_mgr
              from public.profiles p2
              join public.memberships m2 on m2.user_id = p2.id and m2.tenant_id = v_tenant
             where p2.cpf = v_mgr_digits;
          end if;
          if v_mgr is null then
            select m2.user_id into v_mgr from public.memberships m2
             where m2.tenant_id = v_tenant and m2.employee_code = v_mgr_ref;
          end if;
          if v_mgr is null then
            select count(*) into v_mgr_n
              from public.memberships m2
              join public.profiles p2 on p2.id = m2.user_id
             where m2.tenant_id = v_tenant
               and lower(trim(p2.full_name)) = lower(v_mgr_ref);
            if v_mgr_n > 1 then
              v_errors := v_errors || jsonb_build_object('nome', trim(r->>'full_name'), 'cpf', v_cpf,
                'erro', 'Gestor ambíguo: mais de um colaborador chamado "' || v_mgr_ref || '". Use a matrícula na coluna Código Gestor.');
              continue;
            elsif v_mgr_n = 1 then
              select m2.user_id into v_mgr
                from public.memberships m2
                join public.profiles p2 on p2.id = m2.user_id
               where m2.tenant_id = v_tenant
                 and lower(trim(p2.full_name)) = lower(v_mgr_ref);
            end if;
          end if;
        end if;
        if v_mgr is null then
          v_errors := v_errors || jsonb_build_object('nome', trim(r->>'full_name'), 'cpf', v_cpf,
            'erro', 'Gestor não encontrado nesta empresa: "' || coalesce(v_mgr_code, v_mgr_ref) || '"');
          continue;
        end if;
        select p2.full_name into v_mgr_name from public.profiles p2 where p2.id = v_mgr;
      end if;

      v_unit_names := '{}';
      if jsonb_typeof(r->'units') = 'array' then
        select array_agg(trim(x)) into v_unit_names from jsonb_array_elements_text(r->'units') as x where nullif(trim(x), '') is not null;
      elsif nullif(trim(r->>'unit'), '') is not null then
        select array_agg(trim(x)) into v_unit_names from regexp_split_to_table(r->>'unit', '[;,/]') as x where nullif(trim(x), '') is not null;
      end if;

      v_dept := null; v_name := nullif(trim(r->>'department'), '');
      if v_name is not null then
        select id into v_dept from public.departments where tenant_id = v_tenant and name = v_name;
        if not found then insert into public.departments(tenant_id, name) values (v_tenant, v_name) returning id into v_dept; end if;
      end if;

      v_sub := null; v_name := nullif(trim(r->>'subdepartment'), '');
      if v_dept is not null and v_name is not null and lower(v_name) not in ('não informado', 'nao informado', 'n/a', '-') then
        select id into v_sub from public.subdepartments where department_id = v_dept and name = v_name;
        if not found then insert into public.subdepartments(tenant_id, department_id, name) values (v_tenant, v_dept, v_name) returning id into v_sub; end if;
      end if;

      v_pos := null; v_name := nullif(trim(r->>'position'), '');
      if v_name is not null then
        select id into v_pos from public.positions where tenant_id = v_tenant and name = v_name;
        if not found then insert into public.positions(tenant_id, name) values (v_tenant, v_name) returning id into v_pos; end if;
      end if;

      v_lvl := null; v_name := nullif(trim(r->>'level'), '');
      if v_name is not null and length(v_name) <= 40 then
        select id into v_lvl from public.position_levels where tenant_id = v_tenant and name = v_name;
        if not found then insert into public.position_levels(tenant_id, name) values (v_tenant, v_name) returning id into v_lvl; end if;
      end if;

      v_gender := case lower(coalesce(trim(r->>'gender'), ''))
                    when 'masculino' then 'masculino' when 'm' then 'masculino'
                    when 'feminino' then 'feminino' when 'f' then 'feminino'
                    when 'outro' then 'outro' else 'nao_informado' end;

      v_email := nullif(lower(trim(r->>'email')), '');
      if v_email is not null and exists (select 1 from auth.users where email = v_email) then v_email := null; end if;

      select id into v_existing_uid from public.profiles where cpf = v_cpf;

      if v_mgr_given and v_mgr is not null and v_mgr = v_existing_uid then
        v_errors := v_errors || jsonb_build_object('nome', trim(r->>'full_name'), 'cpf', v_cpf,
          'erro', 'O gestor não pode ser o próprio colaborador');
        continue;
      end if;

      if v_existing_uid is not null then
        select id, employee_code, admission_date, dismissed_at, department_id, subdepartment_id, position_id, position_level_id, manager_id, role, hierarchy_level_id
          into v_existing_mid, v_existing_code, v_existing_adm, v_ex_dis, v_ex_dept, v_ex_sub, v_ex_pos, v_ex_lvl, v_cur_mgr, v_cur_role, v_cur_hier
        from public.memberships where tenant_id = v_tenant and user_id = v_existing_uid;

        -- quem já é owner/admin não é rebaixado por planilha: o teto de privilégio
        -- vale nos dois sentidos, senão uma coluna esquecida derrubaria um admin
        if v_role_given and v_existing_mid is not null and v_cur_role in ('owner', 'admin') then
          v_role_given := false;
        end if;

        if v_existing_mid is null then
          insert into public.memberships (tenant_id, user_id, role, employee_code, admission_date,
            department_id, subdepartment_id, position_id, position_level_id, hierarchy_level_id,
            manager_id, is_active, dismissed_at)
          values (v_tenant, v_existing_uid, coalesce(v_role, 'member'), v_code, v_adm,
            v_dept, v_sub, v_pos, v_lvl, v_hier, v_mgr, v_dismissed is null, v_dismissed)
          returning id into v_mid;
          v_created := v_created + 1;

        elsif v_code is not null and v_existing_code is distinct from v_code then
          if v_adm is not null and v_existing_adm is not null and v_adm < v_existing_adm then
            insert into public.employee_contracts (tenant_id, user_id, employee_code, admission_date,
              dismissed_at, department_id, subdepartment_id, position_id, position_level_id, source)
            values (v_tenant, v_existing_uid, v_code, v_adm, v_dismissed, v_dept, v_sub, v_pos, v_lvl, 'import')
            on conflict do nothing;
            v_archived := v_archived + 1;
            v_skipped := v_skipped + 1;
            v_skipped_list := v_skipped_list || jsonb_build_object(
              'nome', trim(r->>'full_name'), 'cpf', v_cpf, 'codigo', v_code,
              'motivo', 'Contrato anterior (admissão ' || to_char(v_adm, 'DD/MM/YYYY') ||
                        ') guardado no histórico. Cadastro atual mantido (admissão ' || to_char(v_existing_adm, 'DD/MM/YYYY') ||
                        ', código ' || coalesce(v_existing_code, 'sem código') || ').');
            continue;
          end if;

          insert into public.employee_contracts (tenant_id, user_id, employee_code, admission_date,
            dismissed_at, department_id, subdepartment_id, position_id, position_level_id, source)
          values (v_tenant, v_existing_uid, v_existing_code, v_existing_adm, v_ex_dis, v_ex_dept, v_ex_sub, v_ex_pos, v_ex_lvl, 'import')
          on conflict do nothing;
          v_archived := v_archived + 1;

          update public.memberships set
            employee_code = v_code,
            admission_date = coalesce(v_adm, admission_date),
            department_id = coalesce(v_dept, department_id),
            subdepartment_id = coalesce(v_sub, subdepartment_id),
            position_id = coalesce(v_pos, position_id),
            position_level_id = coalesce(v_lvl, position_level_id),
            hierarchy_level_id = case when v_hier_given then v_hier else hierarchy_level_id end,
            manager_id = case when v_mgr_given then v_mgr else manager_id end,
            role = case when v_role_given then v_role else role end,
            dismissed_at = v_dismissed,
            is_active = (v_dismissed is null)
          where id = v_existing_mid;
          v_mid := v_existing_mid;
          v_updated := v_updated + 1;
          v_updated_list := v_updated_list || jsonb_build_object(
            'nome', trim(r->>'full_name'), 'cpf', v_cpf,
            'motivo', 'Recontratação: código ' || coalesce(v_existing_code, 'sem código') || ' -> ' || v_code ||
                      ' (contrato anterior guardado no histórico)');

        else
          -- Mesmo código: o cadastro NÃO é reescrito. A planilha só alcança duas
          -- coisas aqui, gestor e perfil, e só se tiver dito algo sobre elas.
          if (v_mgr_given and v_cur_mgr is distinct from v_mgr)
             or (v_role_given and v_cur_role is distinct from v_role)
             or (v_hier_given and v_cur_hier is distinct from v_hier) then

            update public.memberships set
              manager_id = case when v_mgr_given then v_mgr else manager_id end,
              role = case when v_role_given then v_role else role end,
              hierarchy_level_id = case when v_hier_given then v_hier else hierarchy_level_id end
            where id = v_existing_mid;

            if v_mgr_given and v_cur_mgr is distinct from v_mgr then
              v_managers := v_managers + 1;
              v_managers_list := v_managers_list || jsonb_build_object(
                'nome', trim(r->>'full_name'), 'cpf', v_cpf,
                'motivo', case when v_mgr is null then 'Gestor removido'
                               else 'Gestor: ' || coalesce(v_mgr_name, '?') end);
            end if;
            if v_role_given and v_cur_role is distinct from v_role then
              v_roles := v_roles + 1;
              v_roles_list := v_roles_list || jsonb_build_object(
                'nome', trim(r->>'full_name'), 'cpf', v_cpf,
                'motivo', 'Perfil: ' || v_cur_role::text || ' -> ' || v_role::text);
            end if;
            if v_hier_given and v_cur_hier is distinct from v_hier then
              v_hiers := v_hiers + 1;
              v_hiers_list := v_hiers_list || jsonb_build_object(
                'nome', trim(r->>'full_name'), 'cpf', v_cpf,
                'motivo', case when v_hier is null then 'Hierarquia removida'
                               else 'Hierarquia: ' || coalesce(v_hier_label, '?') end);
            end if;
          else
            v_skipped := v_skipped + 1;
            v_skipped_list := v_skipped_list || jsonb_build_object(
              'nome', trim(r->>'full_name'), 'cpf', v_cpf, 'codigo', v_existing_code,
              'motivo', case when v_mgr_given or v_role_given or v_hier_given then 'Já cadastrado, nada a mudar'
                             else 'Já cadastrado com o mesmo código' end);
          end if;
          continue;
        end if;

        update public.profiles set
          full_name = trim(r->>'full_name'),
          email = coalesce(v_email, email),
          phone = coalesce(nullif(trim(r->>'phone'), ''), phone),
          birth_date = coalesce(public.parse_br_date(r->>'birth_date'), birth_date),
          gender = v_gender
        where id = v_existing_uid;

      else
        v_auth_email := coalesce(v_email, v_cpf || '@cpf.managerhub.local');
        if exists (select 1 from auth.users where email = v_auth_email) then
          v_errors := v_errors || jsonb_build_object('nome', trim(r->>'full_name'), 'cpf', v_cpf, 'erro', 'Conta já existe'); continue;
        end if;

        v_uid := gen_random_uuid();
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change, email_change_token_new, recovery_token)
        values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_auth_email, v_hash, now(), now(), now(), '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', trim(r->>'full_name')), '', '', '', '');
        insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
        values (gen_random_uuid(), v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_auth_email), 'email', v_uid::text, now(), now(), now());

        insert into public.profiles (id, email, full_name, cpf, phone, birth_date, gender)
        values (v_uid, v_email, trim(r->>'full_name'), v_cpf, nullif(trim(r->>'phone'), ''), public.parse_br_date(r->>'birth_date'), v_gender)
        on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, cpf = excluded.cpf, phone = excluded.phone, birth_date = excluded.birth_date, gender = excluded.gender;

        insert into public.memberships (tenant_id, user_id, role, employee_code, admission_date, department_id, subdepartment_id, position_id, position_level_id, hierarchy_level_id, manager_id, is_active, dismissed_at)
        values (v_tenant, v_uid, coalesce(v_role, 'member'), v_code, v_adm, v_dept, v_sub, v_pos, v_lvl, v_hier, v_mgr, v_dismissed is null, v_dismissed)
        returning id into v_mid;
        v_created := v_created + 1;
      end if;

      if v_unit_names is not null and v_mid is not null then
        foreach v_name in array v_unit_names loop
          v_kind := case when upper(v_name) = 'MATRIZ' then 'matriz' else 'filial' end;
          select id into v_unit from public.units where tenant_id = v_tenant and name = v_name;
          if not found then insert into public.units(tenant_id, name, kind) values (v_tenant, v_name, v_kind) returning id into v_unit; end if;
          insert into public.membership_units (membership_id, unit_id) values (v_mid, v_unit) on conflict do nothing;
        end loop;
      end if;

    exception when others then
      v_errors := v_errors || jsonb_build_object('nome', r->>'full_name', 'cpf', v_cpf, 'erro', SQLERRM);
    end;
  end loop;

  return jsonb_build_object(
    'created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'archived', v_archived,
    'managers', v_managers, 'roles', v_roles, 'hierarchies', v_hiers,
    'skippedList', v_skipped_list, 'updatedList', v_updated_list,
    'managersList', v_managers_list, 'rolesList', v_roles_list,
    'hierarchiesList', v_hiers_list, 'errors', v_errors);
end $function$;

revoke execute on function public.admin_import_employees(jsonb, text) from public, anon;
grant execute on function public.admin_import_employees(jsonb, text) to authenticated;
