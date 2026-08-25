-- Para onde vai o link de recuperação de senha.
--
-- A pergunta parece trivial e não é. O e-mail de AUTENTICAÇÃO e o e-mail de
-- CONTATO são colunas diferentes, e na base real elas divergem na maioria dos
-- casos:
--
--   68 pessoas  -> `profiles.email` e `auth.users.email` preenchidos e iguais
--   175 pessoas -> e-mail REAL só em `auth.users.email`; `profiles.email` NULO
--   66 pessoas  -> `auth.users.email` sintético (`<cpf>@cpf.managerhub.local`),
--                  `profiles.email` NULO: não têm para onde receber nada
--
-- Ou seja: usar `profiles.email` como destino deixaria 57% do quadro ativo sem
-- receber o link, em silêncio. E usar `auth.users.email` cegamente mandaria
-- e-mail para um domínio que não existe. Daí o `coalesce` com o descarte
-- explícito do domínio sintético.
--
-- A distinção que o chamador precisa respeitar:
--   `auth_email` -> é o que `admin.generateLink` exige (a chave de autenticação);
--   `destino`    -> é para onde o e-mail é enviado de fato.
-- Confundir os dois é o modo de falha central deste recurso.

create or replace function public.destino_de_recuperacao(p_identificador text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_id     text := lower(btrim(coalesce(p_identificador, '')));
  v_cpf    text;
  v_user   record;
  v_destino text;
  v_tenant uuid;
  v_ativo  boolean;
begin
  -- Guarda real no corpo. Não existe `auth.uid()` aqui: a recuperação acontece
  -- ANTES de haver sessão. A guarda é o papel do chamador, que só pode ser o
  -- service role, de dentro do servidor (molde de `auth_throttle_*`). Exposta,
  -- esta função seria um oráculo de CPF para e-mail corporativo, exatamente o
  -- que a migração 20260802233542 fechou para `email_by_cpf`.
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Sem permissão';
  end if;

  if v_id = '' then
    return jsonb_build_object('achou', false);
  end if;

  if position('@' in v_id) > 0 then
    -- O domínio sintético não é endereço de ninguém: não serve nem para buscar.
    if v_id like '%@cpf.managerhub.local' then
      return jsonb_build_object('achou', false);
    end if;
    select u.id, u.email as auth_email, p.email as contato, p.full_name
      into v_user
      from auth.users u
      join public.profiles p on p.id = u.id
     where lower(u.email) = v_id or lower(coalesce(p.email, '')) = v_id
     limit 1;
  else
    v_cpf := regexp_replace(v_id, '[^0-9]', '', 'g');
    if length(v_cpf) <> 11 then
      return jsonb_build_object('achou', false);
    end if;
    -- Ler `profiles.cpf` aqui é legítimo apesar do revoke de coluna: dentro de
    -- uma SECURITY DEFINER o usuário efetivo é o dono (ver AGENTS.md).
    select u.id, u.email as auth_email, p.email as contato, p.full_name
      into v_user
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.cpf = v_cpf
     limit 1;
  end if;

  if v_user.id is null then
    return jsonb_build_object('achou', false);
  end if;

  -- Quem não pode entrar não recebe credencial de redefinição. Um desligado
  -- definiria a senha e cairia em /suspenso; mandar link vivo para quem a
  -- empresa cortou é regressão de segurança, não cortesia. A regra mora AQUI e
  -- não no TypeScript para não existirem duas versões dela.
  select m.tenant_id into v_tenant
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
   where m.user_id = v_user.id and m.is_active and t.status = 'active'
   order by m.created_at
   limit 1;

  -- O owner de plataforma administra o sistema sem pertencer a empresa nenhuma:
  -- sem esta cláusula ele seria o único incapaz de recuperar a própria senha.
  v_ativo := v_tenant is not null
             or exists (select 1 from public.platform_admins pa where pa.user_id = v_user.id);

  if not v_ativo then
    return jsonb_build_object('achou', false);
  end if;

  v_destino := nullif(btrim(coalesce(v_user.contato, '')), '');
  if v_destino is null and v_user.auth_email not like '%@cpf.managerhub.local' then
    v_destino := v_user.auth_email;
  end if;

  -- Endereço sem TLD ("fulano@gmail") passaria pelo filtro do mailer, que só
  -- testa a presença do "@", e viraria bounce silencioso. Melhor tratar como
  -- quem não tem e-mail: assim o departamento pessoal é avisado.
  if v_destino is not null
     and v_destino !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    v_destino := null;
  end if;

  return jsonb_build_object(
    'achou', true,
    'user_id', v_user.id,
    'auth_email', v_user.auth_email,
    'destino', v_destino,
    'nome', v_user.full_name,
    'tenant_id', v_tenant
  );
end;
$$;

revoke execute on function public.destino_de_recuperacao(text) from public, anon, authenticated;

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception 'ha % funcoes SECURITY DEFINER alcancaveis por anon', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
