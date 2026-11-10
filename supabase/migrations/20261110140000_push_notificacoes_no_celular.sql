-- Notificações no celular (Web Push), pedido do LUIZ em 10/11/2026.
--
-- Caminho de um aviso: qualquer INSERT em `notifications` (venha de RPC,
-- trigger ou service role) dispara, depois do COMMIT, uma chamada do pg_net à
-- rota /api/push do app. A rota pede a esta base o que enviar
-- (`push_para_enviar`), cifra para cada aparelho e manda ao serviço de push.
--
-- A chamada leva um segredo do Vault, e a rota só recebe notificação criada há
-- menos de 15 minutos e ainda não enviada: repetir a chamada não repete o aviso.

create extension if not exists pg_net;

-- ── aparelhos inscritos ───────────────────────────────────────────────────
create table if not exists public.push_inscricoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- o endereço que o serviço de push deu ao aparelho; um aparelho, uma pessoa
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  aparelho text,
  created_at timestamptz not null default now(),
  usado_em timestamptz
);
create index if not exists push_inscricoes_user_idx on public.push_inscricoes(user_id);
alter table public.push_inscricoes enable row level security;
revoke all on table public.push_inscricoes from public, anon, authenticated;

-- ── notificações já enviadas (trava de repetição) ─────────────────────────
create table if not exists public.push_enviadas (
  notification_id uuid primary key references public.notifications(id) on delete cascade,
  enviada_em timestamptz not null default now()
);
alter table public.push_enviadas enable row level security;
revoke all on table public.push_enviadas from public, anon, authenticated;

-- ── segredo da chamada banco → app ────────────────────────────────────────
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'push_webhook_segredo') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'push_webhook_segredo',
      'Autentica a chamada do pg_net à rota /api/push'
    );
  end if;
end $$;

-- ── inscrição do próprio aparelho (app, sessão do usuário) ────────────────
create or replace function public.push_inscrever(p_endpoint text, p_p256dh text, p_auth text, p_aparelho text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sessão expirada. Faça login novamente.' using errcode = '42501';
  end if;
  -- só serviços de push conhecidos: a rota faz POST nesse endereço, e um
  -- endereço qualquer viraria o servidor do app chamando quem a pessoa quiser
  if p_endpoint is null or length(p_endpoint) > 1000
     or p_endpoint !~* '^https://([a-z0-9-]+\.)*(googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)/' then
    raise exception 'Serviço de notificação não reconhecido.' using errcode = '22023';
  end if;
  if coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_-]{80,100}=*$' or coalesce(p_auth, '') !~ '^[A-Za-z0-9_-]{16,40}=*$' then
    raise exception 'Chave do aparelho inválida.' using errcode = '22023';
  end if;

  -- o aparelho passa a ser de quem ativou agora (outra pessoa pode ter usado antes)
  insert into push_inscricoes as i (user_id, endpoint, p256dh, auth, aparelho)
  values (v_user, p_endpoint, p_p256dh, p_auth, left(p_aparelho, 120))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        aparelho = excluded.aparelho,
        created_at = case when i.user_id = excluded.user_id then i.created_at else now() end;

  -- teto de 10 aparelhos por pessoa, os mais recentes
  delete from push_inscricoes
   where id in (select id from push_inscricoes where user_id = v_user order by created_at desc offset 10);
end $$;
revoke execute on function public.push_inscrever(text, text, text, text) from public, anon;

create or replace function public.push_cancelar(p_endpoint text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Faça login novamente.' using errcode = '42501';
  end if;
  delete from push_inscricoes where endpoint = p_endpoint and user_id = auth.uid();
end $$;
revoke execute on function public.push_cancelar(text) from public, anon;

-- o aparelho está ligado para MIM? (pode estar inscrito para outra pessoa)
create or replace function public.push_status(p_endpoint text)
returns boolean
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if auth.uid() is null then return false; end if;
  return exists (select 1 from push_inscricoes where endpoint = p_endpoint and user_id = auth.uid());
end $$;
revoke execute on function public.push_status(text) from public, anon;

-- aviso de confirmação ao ativar: passa pelo caminho inteiro, como um aviso real
create or replace function public.push_teste(p_tenant uuid)
returns boolean
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not (is_tenant_member(p_tenant) or is_super_admin()) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if exists (
    select 1 from notifications
     where user_id = v_user and type = 'push_teste' and created_at > now() - interval '30 seconds'
  ) then
    return false;
  end if;
  insert into notifications (tenant_id, user_id, type, title, body)
  values (p_tenant, v_user, 'push_teste', 'Notificações ativadas',
          'Os avisos do Manager HUB vão chegar neste aparelho, mesmo com o app fechado.');
  return true;
end $$;
revoke execute on function public.push_teste(uuid) from public, anon;

-- ── lado do servidor do app (service role + segredo) ──────────────────────
create or replace function public.push_para_enviar(p_segredo text, p_ids uuid[])
returns table (
  notification_id uuid, type text, title text, body text,
  demanda_id uuid, planner_board_id uuid, endpoint text, p256dh text, chave_auth text
)
language plpgsql security definer set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_segredo is null or p_segredo is distinct from (
    select decrypted_secret from vault.decrypted_secrets where name = 'push_webhook_segredo'
  ) then
    raise exception 'Chamada recusada.' using errcode = '42501';
  end if;

  return query
  with reivindicadas as (
    insert into push_enviadas (notification_id)
    select n.id from notifications n
     where n.id = any (p_ids[1:1000]) and n.created_at > now() - interval '15 minutes'
    on conflict do nothing
    returning push_enviadas.notification_id
  )
  select n.id, n.type, n.title, n.body, n.demanda_id, n.planner_board_id, s.endpoint, s.p256dh, s.auth
    from reivindicadas r
    join notifications n on n.id = r.notification_id
    join push_inscricoes s on s.user_id = n.user_id;
end $$;
revoke execute on function public.push_para_enviar(text, uuid[]) from public, anon, authenticated;

create or replace function public.push_resultado(p_segredo text, p_ok text[], p_expiradas text[])
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_segredo is null or p_segredo is distinct from (
    select decrypted_secret from vault.decrypted_secrets where name = 'push_webhook_segredo'
  ) then
    raise exception 'Chamada recusada.' using errcode = '42501';
  end if;
  update push_inscricoes set usado_em = now() where endpoint = any (coalesce(p_ok, '{}'));
  -- desinstalou ou desligou no aparelho: o serviço respondeu 404/410
  delete from push_inscricoes where endpoint = any (coalesce(p_expiradas, '{}'));
end $$;
revoke execute on function public.push_resultado(text, text[], text[]) from public, anon, authenticated;

-- par VAPID: gerado uma vez pelo servidor do app, guardado só no Vault
create or replace function public.push_vapid()
returns table (publica text, privada text)
language plpgsql security definer set search_path to 'public'
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  return query
  select (select decrypted_secret from vault.decrypted_secrets where name = 'push_vapid_publica'),
         (select decrypted_secret from vault.decrypted_secrets where name = 'push_vapid_privada');
end $$;
revoke execute on function public.push_vapid() from public, anon, authenticated;

-- grava o par só se ainda não houver; devolve o que valer (primeiro a chegar)
create or replace function public.push_vapid_definir(p_publica text, p_privada text)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_publica text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('push_vapid'));
  select decrypted_secret into v_publica from vault.decrypted_secrets where name = 'push_vapid_publica';
  if v_publica is not null then
    return v_publica;
  end if;
  if coalesce(p_publica, '') !~ '^[A-Za-z0-9_-]{87}$' or coalesce(p_privada, '') !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'Chave VAPID inválida.' using errcode = '22023';
  end if;
  perform vault.create_secret(p_privada, 'push_vapid_privada', 'Chave privada VAPID do Web Push');
  perform vault.create_secret(p_publica, 'push_vapid_publica', 'Chave pública VAPID do Web Push');
  return p_publica;
end $$;
revoke execute on function public.push_vapid_definir(text, text) from public, anon, authenticated;

-- ── o disparo ─────────────────────────────────────────────────────────────
create or replace function public.push_disparar()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ids uuid[];
  v_segredo text;
begin
  -- só chama o app se alguém desta leva tem aparelho inscrito
  select array_agg(n.id) into v_ids
    from novas n
   where exists (select 1 from push_inscricoes s where s.user_id = n.user_id);
  if v_ids is null then
    return null;
  end if;

  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'push_webhook_segredo';
  if v_segredo is null then
    return null;
  end if;

  -- pg_net enfileira e envia depois do COMMIT: rollback não manda nada
  perform net.http_post(
    url := 'https://managerhub.4yousmartsolutions.com.br/api/push',
    body := jsonb_build_object('ids', to_jsonb(v_ids)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-segredo', v_segredo),
    timeout_milliseconds := 15000
  );
  return null;
exception when others then
  -- o aviso no celular nunca pode impedir a notificação de existir
  raise warning 'push_disparar: %', sqlerrm;
  return null;
end $$;
revoke execute on function public.push_disparar() from public, anon, authenticated;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push
  after insert on public.notifications
  referencing new table as novas
  for each statement execute function public.push_disparar();

notify pgrst, 'reload schema';
