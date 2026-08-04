-- Cadastro e edição de colaborador passam a gravar a hierarquia.
--
-- O delta em relação à versão anterior é uma coluna em cada função
-- (`hierarchy_level_id`), mas a definição vai inteira porque `create or replace
-- function` substitui o corpo todo: não existe "alterar um campo" aqui.
--
-- De passagem: a mensagem de senha em admin_create_employee dizia "mínima de 6"
-- enquanto a checagem já era `< 8`, sobra da onda de segurança que subiu o mínimo.

create or replace function public.admin_create_employee(p_data jsonb, p_password text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_caller uuid := auth.uid();
  v_tenant uuid := public.my_active_tenant();
  v_uid uuid := gen_random_uuid();
  v_email text := nullif(lower(trim(p_data->>'email')), '');
  v_cpf text := nullif(regexp_replace(coalesce(p_data->>'cpf', ''), '[^0-9]', '', 'g'), '');
  v_auth_email text;
  v_membership uuid;
  v_unit uuid;
begin
  if v_caller is null then raise exception 'Não autenticado'; end if;
  if v_tenant is null or not public.has_tenant_role(v_tenant, array['owner','admin']::member_role[]) then
    raise exception 'Sem permissão';
  end if;
  if coalesce(nullif(p_data->>'role','')::member_role, 'member') = 'owner' and not public.is_super_admin() then
    raise exception 'Apenas o proprietário do sistema pode criar um proprietário';
  end if;
  if coalesce(trim(p_data->>'full_name'), '') = '' then raise exception 'Informe o nome completo'; end if;
  if v_cpf is null or v_cpf !~ '^[0-9]{11}$' then raise exception 'CPF inválido'; end if;
  if p_password is null or length(p_password) < 8 then raise exception 'Senha mínima de 8 caracteres'; end if;
  if exists (select 1 from public.profiles where cpf = v_cpf) then raise exception 'CPF já cadastrado'; end if;
  if v_email is not null and exists (select 1 from auth.users where email = v_email) then
    raise exception 'E-mail já cadastrado';
  end if;

  v_auth_email := coalesce(v_email, v_cpf || '@cpf.managerhub.local');
  if exists (select 1 from auth.users where email = v_auth_email) then raise exception 'Conta já existe'; end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    v_auth_email, crypt(p_password, gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_data->>'full_name'),
    '', '', '', ''
  );
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_auth_email), 'email', v_uid::text, now(), now(), now());

  insert into public.profiles (id, email, full_name, cpf, phone, birth_date, gender)
  values (
    v_uid, v_email, trim(p_data->>'full_name'), v_cpf,
    nullif(trim(p_data->>'phone'), ''),
    nullif(p_data->>'birth_date', '')::date,
    nullif(p_data->>'gender', '')::gender_type
  )
  on conflict (id) do update set
    email = excluded.email, full_name = excluded.full_name, cpf = excluded.cpf,
    phone = excluded.phone, birth_date = excluded.birth_date, gender = excluded.gender;

  insert into public.memberships (
    tenant_id, user_id, role, employee_code, admission_date,
    department_id, subdepartment_id, position_id, position_level_id,
    hierarchy_level_id, manager_id
  ) values (
    v_tenant, v_uid,
    coalesce(nullif(p_data->>'role', '')::member_role, 'member'),
    nullif(trim(p_data->>'employee_code'), ''),
    nullif(p_data->>'admission_date', '')::date,
    nullif(p_data->>'department_id', '')::uuid,
    nullif(p_data->>'subdepartment_id', '')::uuid,
    nullif(p_data->>'position_id', '')::uuid,
    nullif(p_data->>'position_level_id', '')::uuid,
    nullif(p_data->>'hierarchy_level_id', '')::uuid,
    nullif(p_data->>'manager_id', '')::uuid
  ) returning id into v_membership;

  for v_unit in select (jsonb_array_elements_text(coalesce(p_data->'unit_ids', '[]'::jsonb)))::uuid loop
    insert into public.membership_units (membership_id, unit_id) values (v_membership, v_unit)
    on conflict do nothing;
  end loop;

  return v_uid;
end;
$function$;

create or replace function public.admin_update_employee(p_user uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant uuid := public.my_active_tenant();
  v_email text := nullif(lower(trim(p_data->>'email')), '');
  v_cpf text := nullif(regexp_replace(coalesce(p_data->>'cpf', ''), '[^0-9]', '', 'g'), '');
  v_auth_email text;
  v_membership uuid;
  v_unit uuid;
  v_current_role member_role;
  v_new_role member_role := nullif(p_data->>'role', '')::member_role;
begin
  if v_tenant is null or not public.has_tenant_role(v_tenant, array['owner','admin']::member_role[]) then
    raise exception 'Sem permissão';
  end if;
  if not exists (select 1 from public.memberships where user_id = p_user and tenant_id = v_tenant) then
    raise exception 'Usuário não pertence à empresa';
  end if;

  select role into v_current_role from public.memberships where user_id = p_user and tenant_id = v_tenant;
  if v_new_role is not null and v_new_role <> v_current_role and (v_new_role = 'owner' or v_current_role = 'owner') then
    if not public.is_super_admin() then
      raise exception 'Apenas o proprietário do sistema pode alterar o papel de proprietário';
    end if;
    if v_current_role = 'owner' and (select count(*) from public.memberships where tenant_id = v_tenant and role = 'owner') <= 1 then
      raise exception 'Cadastre outro proprietário antes de rebaixar este';
    end if;
  end if;

  if coalesce(trim(p_data->>'full_name'), '') = '' then raise exception 'Informe o nome completo'; end if;
  if v_cpf is null or v_cpf !~ '^[0-9]{11}$' then raise exception 'CPF inválido'; end if;
  if exists (select 1 from public.profiles where cpf = v_cpf and id <> p_user) then raise exception 'CPF já cadastrado'; end if;
  if v_email is not null and exists (select 1 from auth.users where email = v_email and id <> p_user) then
    raise exception 'E-mail já cadastrado';
  end if;

  v_auth_email := coalesce(v_email, v_cpf || '@cpf.managerhub.local');
  update auth.users
    set email = v_auth_email, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
  where id = p_user;
  update auth.identities
    set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_auth_email)), updated_at = now()
  where user_id = p_user and provider = 'email';

  update public.profiles set
    email = v_email, full_name = trim(p_data->>'full_name'), cpf = v_cpf,
    phone = nullif(trim(p_data->>'phone'), ''),
    birth_date = nullif(p_data->>'birth_date', '')::date,
    gender = nullif(p_data->>'gender', '')::gender_type,
    updated_at = now()
  where id = p_user;

  update public.memberships set
    role = coalesce(nullif(p_data->>'role', '')::member_role, role),
    employee_code = nullif(trim(p_data->>'employee_code'), ''),
    admission_date = nullif(p_data->>'admission_date', '')::date,
    department_id = nullif(p_data->>'department_id', '')::uuid,
    subdepartment_id = nullif(p_data->>'subdepartment_id', '')::uuid,
    position_id = nullif(p_data->>'position_id', '')::uuid,
    position_level_id = nullif(p_data->>'position_level_id', '')::uuid,
    hierarchy_level_id = nullif(p_data->>'hierarchy_level_id', '')::uuid,
    manager_id = nullif(p_data->>'manager_id', '')::uuid
  where user_id = p_user and tenant_id = v_tenant
  returning id into v_membership;

  delete from public.membership_units where membership_id = v_membership;
  for v_unit in select (jsonb_array_elements_text(coalesce(p_data->'unit_ids', '[]'::jsonb)))::uuid loop
    insert into public.membership_units (membership_id, unit_id) values (v_membership, v_unit)
    on conflict do nothing;
  end loop;
end;
$function$;

-- AGENTS.md
revoke execute on function public.admin_create_employee(jsonb, text) from public, anon;
revoke execute on function public.admin_update_employee(uuid, jsonb) from public, anon;
grant execute on function public.admin_create_employee(jsonb, text) to authenticated;
grant execute on function public.admin_update_employee(uuid, jsonb) to authenticated;
