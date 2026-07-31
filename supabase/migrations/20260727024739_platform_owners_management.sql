-- Cria um OWNER DE PLATAFORMA (super admin) sem empresa vinculada.
-- Mesma técnica de auth.users do platform_create_company, sem tenant/membership.
create or replace function public.platform_create_owner(p_email text, p_password text, p_name text)
returns uuid language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare v_uid uuid := gen_random_uuid(); v_email text := lower(trim(p_email));
begin
  if not public.is_super_admin() then raise exception 'Sem permissão'; end if;
  if v_email = '' or p_password is null or length(p_password) < 6 then
    raise exception 'E-mail e senha (mín. 6 caracteres) são obrigatórios';
  end if;
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'E-mail já cadastrado';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    v_email, crypt(p_password, gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_name),
    '', '', '', ''
  );
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_email), 'email', v_uid::text, now(), now(), now());

  insert into public.profiles (id, email, full_name) values (v_uid, v_email, p_name)
  on conflict (id) do update set full_name = excluded.full_name, email = excluded.email;

  insert into public.platform_admins (user_id) values (v_uid) on conflict do nothing;
  return v_uid;
end; $function$;

-- Promove um usuário EXISTENTE (por e-mail) a super admin.
create or replace function public.platform_grant_admin(p_email text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid; v_email text := lower(trim(p_email));
begin
  if not public.is_super_admin() then raise exception 'Sem permissão'; end if;
  select id into v_uid from auth.users where email = v_email;
  if v_uid is null then raise exception 'Usuário não encontrado para o e-mail informado'; end if;
  insert into public.platform_admins (user_id) values (v_uid) on conflict do nothing;
end; $function$;

-- Revoga super admin. Trava: nunca remove o último owner (evita lockout).
create or replace function public.platform_revoke_admin(p_user uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.is_super_admin() then raise exception 'Sem permissão'; end if;
  if (select count(*) from public.platform_admins) <= 1 then
    raise exception 'Não é possível remover o último owner de plataforma';
  end if;
  delete from public.platform_admins where user_id = p_user;
end; $function$;

-- Lista os owners de plataforma (join com auth.users/profiles), super-admin-only.
create or replace function public.platform_admins_list()
returns table(user_id uuid, email text, full_name text, created_at timestamptz)
language sql security definer set search_path to 'public' as $function$
  select pa.user_id, u.email::text, p.full_name, pa.created_at
  from public.platform_admins pa
  left join auth.users u on u.id = pa.user_id
  left join public.profiles p on p.id = pa.user_id
  where public.is_super_admin()
  order by pa.created_at;
$function$;
