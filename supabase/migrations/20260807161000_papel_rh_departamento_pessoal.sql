-- O que o RH alcança, e o que ele NÃO alcança.
--
-- RH edita departamento pessoal: cadastro de colaborador, férias e afastamentos,
-- punições e remuneração variável (valores, redutores e catálogo de punições).
-- Fora disso ele é `member`: metas, checklists, feedbacks, chamados, SDPO, salas,
-- feriados, logs e cadastro da empresa continuam owner/admin.
--
-- Duas coisas ele expressamente não faz, por decisão do produto:
--   * redefinir senha de ninguém (`admin_set_password` fica sem `hr`);
--   * promover ninguém (a coluna `memberships.role` é intocável para ele).
--
-- A segunda é o ponto delicado. A RLS decide LINHA, nunca coluna: qualquer
-- policy de update que alcance a linha do colega alcança junto o `role` dela, e
-- o RH viraria administrador sozinho pelo PostgREST. Por isso o `role` é
-- guardado por TRIGGER, e não por policy: o trigger roda em todo caminho, RPC
-- `SECURITY DEFINER` inclusive, porque `has_tenant_role` lê o `auth.uid()` do
-- JWT e não o dono da função.

-- ---------------------------------------------------------------- dado pessoal
drop policy if exists employee_absences_read on public.employee_absences;
create policy employee_absences_read on public.employee_absences for select
  using (public.has_tenant_role(tenant_id, array['owner','admin','manager','hr']::member_role[]));

drop policy if exists employee_absences_write on public.employee_absences;
create policy employee_absences_write on public.employee_absences for all
  using (public.has_tenant_role(tenant_id, array['owner','admin','hr']::member_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin','hr']::member_role[]));

drop policy if exists employee_sanctions_read on public.employee_sanctions;
create policy employee_sanctions_read on public.employee_sanctions for select
  using (public.has_tenant_role(tenant_id, array['owner','admin','manager','hr']::member_role[]));

drop policy if exists employee_sanctions_write on public.employee_sanctions;
create policy employee_sanctions_write on public.employee_sanctions for all
  using (public.has_tenant_role(tenant_id, array['owner','admin','hr']::member_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin','hr']::member_role[]));

drop policy if exists sanction_types_write on public.sanction_types;
create policy sanction_types_write on public.sanction_types for all
  using (tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::member_role[])));

-- ------------------------------------------------------ remuneração variável
drop policy if exists irc_admin_all on public.individual_rv_config;
create policy irc_admin_all on public.individual_rv_config for all
  using (
    tenant_id in (select public.my_tenant_ids())
    and tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::member_role[]))
  )
  with check (
    tenant_id in (select public.my_tenant_ids())
    and tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::member_role[]))
  );

-- o Gerencial só lê; a policy de leitura é separada porque `for all` não
-- distingue comando e somá-lo acima lhe daria escrita junto
drop policy if exists irc_manager_select on public.individual_rv_config;
create policy irc_manager_select on public.individual_rv_config for select
  using (tenant_id in (select public.my_role_tenant_ids('{owner,admin,manager,hr}'::member_role[])));

drop policy if exists rv_reducer_rules_write on public.rv_reducer_rules;
create policy rv_reducer_rules_write on public.rv_reducer_rules for all
  using (tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::member_role[])));

drop policy if exists rv_reducer_bands_write on public.rv_reducer_bands;
create policy rv_reducer_bands_write on public.rv_reducer_bands for all
  using (tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::member_role[])));

-- --------------------------------------------------------------- colaborador
-- UPDATE, não ALL: inativar e corrigir cadastro sim, apagar vínculo não. Criar
-- colaborador continua sendo `admin_create_employee`, que é SECURITY DEFINER e
-- nem passa por aqui.
drop policy if exists memberships_hr_update on public.memberships;
create policy memberships_hr_update on public.memberships for update
  using (tenant_id in (select public.my_role_tenant_ids('{hr}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{hr}'::member_role[])));

-- A trava de papel. Vale para todo caminho, e é por isso que ela não mora
-- dentro das RPCs: PostgREST, RPC, action futura ou script, todos passam aqui.
create or replace function public.rh_nao_define_papel()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- quem não está agindo como RH nesta empresa passa reto
  if not public.has_tenant_role(new.tenant_id, array['hr']::member_role[]) then
    return new;
  end if;
  -- o vínculo é um só por empresa, então na prática ninguém é hr e admin ao
  -- mesmo tempo; a checagem existe para o dia em que isso mudar
  if public.has_tenant_role(new.tenant_id, array['owner','admin']::member_role[]) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role in ('owner', 'admin', 'hr') then
      raise exception 'O RH não pode criar proprietário, administrador ou RH';
    end if;
  elsif new.role is distinct from old.role then
    raise exception 'O RH não pode alterar o perfil de acesso do colaborador';
  end if;
  return new;
end;
$$;

revoke execute on function public.rh_nao_define_papel() from public, anon, authenticated;

drop trigger if exists memberships_rh_nao_define_papel on public.memberships;
create trigger memberships_rh_nao_define_papel
  before insert or update on public.memberships
  for each row execute function public.rh_nao_define_papel();

-- ------------------------------------------------------------ dados pessoais
-- Sem isto o RH abriria a ficha do colaborador com CPF, telefone e nascimento
-- em branco: as colunas sensíveis de `profiles` estão revogadas e só saem daqui.
create or replace function public.tenant_dados_pessoais(p_tenant uuid default null::uuid)
returns table(id uuid, cpf text, phone text, birth_date date, gender gender_type)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := coalesce(p_tenant, public.my_active_tenant());
begin
  -- guarda real no corpo: nao adianta passar a empresa alheia
  if v_tenant is null
     or not public.has_tenant_role(v_tenant, array['owner','admin','manager','hr']::member_role[]) then
    raise exception 'Sem permissão';
  end if;

  -- so quem tem vinculo com ESTA empresa
  return query
    select p.id, p.cpf, p.phone, p.birth_date, p.gender
    from public.profiles p
    join public.memberships m on m.user_id = p.id and m.tenant_id = v_tenant;
end;
$$;

revoke execute on function public.tenant_dados_pessoais(uuid) from public, anon;

-- ------------------------------------------------------- cadastro por RPC
-- As duas só mudam na linha da guarda. O resto do corpo é o de hoje, repetido
-- porque `create or replace` não aceita remendo parcial.
create or replace function public.admin_create_employee(p_data jsonb, p_password text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
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
  if v_tenant is null or not public.has_tenant_role(v_tenant, array['owner','admin','hr']::member_role[]) then
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
$$;

revoke execute on function public.admin_create_employee(jsonb, text) from public, anon;

create or replace function public.admin_update_employee(p_user uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
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
  if v_tenant is null or not public.has_tenant_role(v_tenant, array['owner','admin','hr']::member_role[]) then
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
$$;

revoke execute on function public.admin_update_employee(uuid, jsonb) from public, anon;
