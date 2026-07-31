
-- Move CNPJ de tenants para units
alter table public.units add column if not exists cnpj text;

-- Unicidade do CNPJ por unidade (ignora nulos)
create unique index if not exists units_cnpj_key on public.units(cnpj) where cnpj is not null;

-- Formato: 14 posições alfanuméricas [0-9A-Z]{12}[0-9]{2}
alter table public.units drop constraint if exists units_cnpj_format;
alter table public.units add constraint units_cnpj_format
  check (cnpj is null or cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$');

-- Remove CNPJ de tenants (com segurança)
alter table public.tenants drop constraint if exists tenants_cnpj_format;
drop index if exists public.tenants_cnpj_key;
alter table public.tenants drop column if exists cnpj;

-- Remove parâmetro CNPJ da criação de empresa no platform admin
drop function if exists public.platform_create_company(text, text, text, text, text);

create or replace function public.platform_create_company(
  p_company text, p_owner_email text, p_owner_password text, p_owner_name text
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_tenant uuid := gen_random_uuid();
  v_uid uuid := gen_random_uuid();
  v_email text := lower(trim(p_owner_email));
  v_slug text;
begin
  if not public.is_super_admin() then raise exception 'Sem permissão'; end if;
  if coalesce(trim(p_company), '') = '' then raise exception 'Informe o nome da empresa'; end if;
  if v_email = '' or p_owner_password is null or length(p_owner_password) < 6 then
    raise exception 'E-mail e senha (mín. 6 caracteres) do owner são obrigatórios';
  end if;
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'E-mail do owner já cadastrado';
  end if;

  v_slug := regexp_replace(lower(trim(p_company)), '[^a-z0-9]+', '-', 'g') || '-' || substr(v_tenant::text, 1, 6);

  insert into public.tenants (id, name, slug) values (v_tenant, trim(p_company), v_slug);

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

revoke all on function public.platform_create_company(text, text, text, text) from public, anon;
grant execute on function public.platform_create_company(text, text, text, text) to authenticated;

-- Atualiza platform_companies (sem cnpj de tenants)
drop function if exists public.platform_companies();
create function public.platform_companies()
returns table (id uuid, name text, slug text, status tenant_status, created_at timestamptz, members_count bigint)
language sql security definer stable set search_path = public as $$
  select t.id, t.name, t.slug, t.status, t.created_at,
    (select count(*) from public.memberships m where m.tenant_id = t.id)
  from public.tenants t where public.is_super_admin()
  order by t.created_at desc;
$$;
revoke all on function public.platform_companies() from public, anon;
grant execute on function public.platform_companies() to authenticated;

notify pgrst, 'reload schema';

