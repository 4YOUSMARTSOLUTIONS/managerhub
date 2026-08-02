-- Importação de colaboradores: uma linha com código diferente pode ser um contrato NOVO
-- (recontratação) ou um contrato ANTIGO (histórico trazido de outro sistema).
--
-- Antes, qualquer código diferente era tratado como recontratação e sobrescrevia o cadastro
-- atual. Quando a planilha trazia o contrato ANTIGO de quem já havia voltado, isso apagava
-- os dados vigentes e ainda inativava a pessoa usando a demissão do contrato encerrado.
--
-- Agora a decisão é pela data de admissão: se a linha for anterior ao cadastro atual, ela é
-- histórico e NÃO pode sobrescrever nem inativar. O motivo aparece no resumo da importação.

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
  v_created int := 0; v_updated int := 0; v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_skipped_list jsonb := '[]'::jsonb;
  v_updated_list jsonb := '[]'::jsonb;
begin
  if v_tenant is null or not public.has_tenant_role(v_tenant, array['owner','admin']::member_role[]) then
    raise exception 'Sem permissão';
  end if;
  if p_password is null or length(p_password) < 6 then raise exception 'Senha padrão mínima de 6 caracteres'; end if;
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

      if v_existing_uid is not null then
        select id, employee_code, admission_date into v_existing_mid, v_existing_code, v_existing_adm
        from public.memberships where tenant_id = v_tenant and user_id = v_existing_uid;

        if v_existing_mid is null then
          -- conta existe em outra empresa: reaproveita o login e cria o vínculo aqui
          insert into public.memberships (tenant_id, user_id, role, employee_code, admission_date,
            department_id, subdepartment_id, position_id, position_level_id, is_active, dismissed_at)
          values (v_tenant, v_existing_uid, 'member', v_code, v_adm,
            v_dept, v_sub, v_pos, v_lvl, v_dismissed is null, v_dismissed)
          returning id into v_mid;
          v_created := v_created + 1;

        elsif v_code is not null and v_existing_code is distinct from v_code then
          -- contrato ANTIGO: a linha é histórico, não pode sobrescrever nem inativar
          if v_adm is not null and v_existing_adm is not null and v_adm < v_existing_adm then
            v_skipped := v_skipped + 1;
            v_skipped_list := v_skipped_list || jsonb_build_object(
              'nome', trim(r->>'full_name'), 'cpf', v_cpf, 'codigo', v_code,
              'motivo', 'Contrato anterior (admissão ' || to_char(v_adm, 'DD/MM/YYYY') ||
                        ') mais antigo que o cadastro atual (admissão ' || to_char(v_existing_adm, 'DD/MM/YYYY') ||
                        ', código ' || coalesce(v_existing_code, 'sem código') || '). Cadastro atual mantido.');
            continue;
          end if;

          -- contrato NOVO: recontratação
          update public.memberships set
            employee_code = v_code,
            admission_date = coalesce(v_adm, admission_date),
            department_id = coalesce(v_dept, department_id),
            subdepartment_id = coalesce(v_sub, subdepartment_id),
            position_id = coalesce(v_pos, position_id),
            position_level_id = coalesce(v_lvl, position_level_id),
            dismissed_at = v_dismissed,
            is_active = (v_dismissed is null)
          where id = v_existing_mid;
          v_mid := v_existing_mid;
          v_updated := v_updated + 1;
          v_updated_list := v_updated_list || jsonb_build_object(
            'nome', trim(r->>'full_name'), 'cpf', v_cpf,
            'motivo', 'Recontratação: código ' || coalesce(v_existing_code, 'sem código') || ' -> ' || v_code);

        else
          v_skipped := v_skipped + 1;
          v_skipped_list := v_skipped_list || jsonb_build_object(
            'nome', trim(r->>'full_name'), 'cpf', v_cpf, 'codigo', v_existing_code,
            'motivo', 'Já cadastrado com o mesmo código');
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

        insert into public.memberships (tenant_id, user_id, role, employee_code, admission_date, department_id, subdepartment_id, position_id, position_level_id, is_active, dismissed_at)
        values (v_tenant, v_uid, 'member', v_code, v_adm, v_dept, v_sub, v_pos, v_lvl, v_dismissed is null, v_dismissed)
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
    'created', v_created, 'updated', v_updated, 'skipped', v_skipped,
    'skippedList', v_skipped_list, 'updatedList', v_updated_list, 'errors', v_errors);
end $function$;
