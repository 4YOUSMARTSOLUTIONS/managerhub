
-- =============================================================
-- MANAGERHUB · Migration 08 · Gestão de usuários pelo admin
-- Funções SECURITY DEFINER: criação/remoção/senha sem service key
-- =============================================================

create or replace function public.my_active_tenant()
returns uuid language sql security definer stable set search_path = public as $$
  select tenant_id from public.memberships
  where user_id = auth.uid() order by created_at limit 1;
$$;

-- ---------- Criar usuário ----------
create or replace function public.admin_create_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_role public.member_role
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_tenant uuid;
  v_uid uuid := gen_random_uuid();
  v_email text := lower(trim(p_email));
begin
  if v_caller is null then raise exception 'Não autenticado'; end if;
  if v_email = '' or p_password is null or length(p_password) < 6 then
    raise exception 'E-mail e senha (mín. 6 caracteres) são obrigatórios';
  end if;

  v_tenant := public.my_active_tenant();
  if v_tenant is null then raise exception 'Sem empresa associada'; end if;
  if not public.has_tenant_role(v_tenant, array['owner','admin']::public.member_role[]) then
    raise exception 'Sem permissão para criar usuários';
  end if;
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'E-mail já cadastrado';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    v_email, crypt(p_password, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', p_full_name),
    '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', v_email),
    'email', v_uid::text, now(), now(), now()
  );

  insert into public.profiles (id, email, full_name)
  values (v_uid, v_email, p_full_name)
  on conflict (id) do update set full_name = excluded.full_name, email = excluded.email;

  insert into public.memberships (tenant_id, user_id, role)
  values (v_tenant, v_uid, p_role)
  on conflict (tenant_id, user_id) do update set role = excluded.role;

  return v_uid;
end;
$$;

-- ---------- Remover usuário ----------
create or replace function public.admin_delete_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_tenant uuid;
begin
  if v_caller is null then raise exception 'Não autenticado'; end if;
  if v_caller = p_user then raise exception 'Você não pode remover a si mesmo'; end if;

  v_tenant := public.my_active_tenant();
  if not public.has_tenant_role(v_tenant, array['owner','admin']::public.member_role[]) then
    raise exception 'Sem permissão';
  end if;
  if not exists (select 1 from public.memberships where user_id = p_user and tenant_id = v_tenant) then
    raise exception 'Usuário não pertence à sua empresa';
  end if;

  delete from auth.users where id = p_user;
end;
$$;

-- ---------- Redefinir senha ----------
create or replace function public.admin_set_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_tenant uuid;
begin
  if v_caller is null then raise exception 'Não autenticado'; end if;
  if p_password is null or length(p_password) < 6 then
    raise exception 'A senha deve ter ao menos 6 caracteres';
  end if;

  v_tenant := public.my_active_tenant();
  if not public.has_tenant_role(v_tenant, array['owner','admin']::public.member_role[]) then
    raise exception 'Sem permissão';
  end if;
  if not exists (select 1 from public.memberships where user_id = p_user and tenant_id = v_tenant) then
    raise exception 'Usuário não pertence à sua empresa';
  end if;

  update auth.users
    set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now()
  where id = p_user;
end;
$$;

-- ---------- Grants ----------
revoke all on function public.my_active_tenant()                        from public, anon;
revoke all on function public.admin_create_user(text, text, text, public.member_role) from public, anon;
revoke all on function public.admin_delete_user(uuid)                   from public, anon;
revoke all on function public.admin_set_password(uuid, text)           from public, anon;
grant execute on function public.admin_create_user(text, text, text, public.member_role) to authenticated;
grant execute on function public.admin_delete_user(uuid)               to authenticated;
grant execute on function public.admin_set_password(uuid, text)        to authenticated;

