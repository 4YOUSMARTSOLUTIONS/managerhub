
-- =============================================================
-- MANAGERHUB · Migration 15 · CNPJ alfanumérico (novo formato)
-- 12 posições alfanuméricas [0-9A-Z] + 2 dígitos verificadores [0-9]
-- =============================================================

alter table public.tenants drop constraint if exists tenants_cnpj_format;
alter table public.tenants add constraint tenants_cnpj_format
  check (cnpj is null or cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$');

create or replace function public.platform_create_company(
  p_company text, p_cnpj text, p_owner_email text, p_owner_password text, p_owner_name text
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_tenant uuid := gen_random_uuid();
  v_uid uuid := gen_random_uuid();
  v_email text := lower(trim(p_owner_email));
  v_cnpj text := nullif(upper(regexp_replace(coalesce(p_cnpj, ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_slug text;
begin
  if not public.is_super_admin() then raise exception 'Sem permissão'; end if;
  if coalesce(trim(p_company), '') = '' then raise exception 'Informe o nome da empresa'; end if;
  if v_cnpj is null or v_cnpj !~ '^[0-9A-Z]{12}[0-9]{2}$' then raise exception 'CNPJ inválido'; end if;
  if v_email = '' or p_owner_password is null or length(p_owner_password) < 6 then
    raise exception 'E-mail e senha (mín. 6 caracteres) do owner são obrigatórios';
  end if;
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'E-mail do owner já cadastrado';
  end if;
  if exists (select 1 from public.tenants where cnpj = v_cnpj) then
    raise exception 'Já existe uma empresa com esse CNPJ';
  end if;

  v_slug := regexp_replace(lower(trim(p_company)), '[^a-z0-9]+', '-', 'g') || '-' || substr(v_tenant::text, 1, 6);

  insert into public.tenants (id, name, slug, cnpj) values (v_tenant, trim(p_company), v_slug, v_cnpj);

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    v_email, crypt(p_owner_password, gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_owner_name),
    '', '', '', ''
  );
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_email), 'email', v_uid::text, now(), now(), now());

  insert into public.profiles (id, email, full_name) values (v_uid, v_email, p_owner_name)
  on conflict (id) do update set full_name = excluded.full_name, email = excluded.email;

  insert into public.memberships (tenant_id, user_id, role) values (v_tenant, v_uid, 'owner');

  return v_tenant;
end;
$$;

