
-- =============================================================
-- MANAGERHUB · Migration 10 · Painel ADM (super-admin de plataforma)
-- =============================================================

-- ---------- Super-admins de plataforma ----------
create table public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
create policy "platform_admins_self_select" on public.platform_admins
  for select using (user_id = auth.uid());

create or replace function public.is_super_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- ---------- Status da empresa (ativa/suspensa) ----------
create type tenant_status as enum ('active', 'suspended');
alter table public.tenants add column status tenant_status not null default 'active';

-- marca o admin atual como super-admin de plataforma
insert into public.platform_admins (user_id)
select id from auth.users where email = 'admin@managerhub.app'
on conflict do nothing;

-- ---------- Listar empresas (com nº de usuários) ----------
create or replace function public.platform_companies()
returns table (
  id uuid, name text, slug text,
  status tenant_status, created_at timestamptz, members_count bigint
)
language sql security definer stable set search_path = public as $$
  select t.id, t.name, t.slug, t.status, t.created_at,
    (select count(*) from public.memberships m where m.tenant_id = t.id)
  from public.tenants t
  where public.is_super_admin()
  order by t.created_at desc;
$$;

-- ---------- Métricas globais (empresas e usuários) ----------
create or replace function public.platform_stats()
returns jsonb language sql security definer stable set search_path = public as $$
  select case when public.is_super_admin() then jsonb_build_object(
    'companies_total',     (select count(*) from public.tenants),
    'companies_active',    (select count(*) from public.tenants where status = 'active'),
    'companies_suspended', (select count(*) from public.tenants where status = 'suspended'),
    'users_total',         (select count(*) from public.memberships),
    'users_distinct',      (select count(distinct user_id) from public.memberships)
  ) else '{}'::jsonb end;
$$;

-- ---------- Cadastrar empresa + owner inicial ----------
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

-- ---------- Suspender / reativar ----------
create or replace function public.platform_set_company_status(p_tenant uuid, p_status tenant_status)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'Sem permissão'; end if;
  update public.tenants set status = p_status, updated_at = now() where id = p_tenant;
end;
$$;

-- ---------- Excluir empresa (e usuários exclusivos dela) ----------
create or replace function public.platform_delete_company(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'Sem permissão'; end if;
  delete from auth.users u
  where exists (select 1 from public.memberships m where m.user_id = u.id and m.tenant_id = p_tenant)
    and not exists (select 1 from public.memberships m2 where m2.user_id = u.id and m2.tenant_id <> p_tenant)
    and not exists (select 1 from public.platform_admins pa where pa.user_id = u.id);
  delete from public.tenants where id = p_tenant;
end;
$$;

-- ---------- Grants ----------
revoke all on function public.is_super_admin()                                  from public, anon;
revoke all on function public.platform_companies()                              from public, anon;
revoke all on function public.platform_stats()                                  from public, anon;
revoke all on function public.platform_create_company(text, text, text, text)   from public, anon;
revoke all on function public.platform_set_company_status(uuid, tenant_status)  from public, anon;
revoke all on function public.platform_delete_company(uuid)                     from public, anon;
grant execute on function public.platform_companies()                            to authenticated;
grant execute on function public.platform_stats()                                to authenticated;
grant execute on function public.platform_create_company(text, text, text, text) to authenticated;
grant execute on function public.platform_set_company_status(uuid, tenant_status) to authenticated;
grant execute on function public.platform_delete_company(uuid)                   to authenticated;

notify pgrst, 'reload schema';

