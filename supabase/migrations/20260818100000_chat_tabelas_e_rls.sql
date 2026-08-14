-- Chat interno: as tabelas e a RLS.
--
-- Conversas 1 a 1 e grupos, mensagens com anexo, preferências (notificações e
-- status manual) e bloqueio administrativo. O tempo real (Realtime), as RPCs de
-- criação e a busca vêm nas migrações seguintes; aqui mora só a estrutura e o
-- QUEM VÊ O QUÊ.
--
-- Três decisões do dono do produto escritas em policy, e não em código:
--
-- 1. AUDITORIA TOTAL: owner/admin/hr leem QUALQUER conversa da empresa,
--    inclusive 1 a 1 de terceiros. É conformidade corporativa, decidida
--    explicitamente, e mora no `is_chat_admin` das policies de select.
-- 2. MENSAGEM É IMUTÁVEL NO BANCO para o cliente: não existe policy nem grant
--    de update/delete em `chat_messages`. Editar e apagar (tombstone) saem só
--    por RPC SECURITY DEFINER com guarda de autor ou de admin.
-- 3. BANIDO SOME: `my_chat_channel_ids()` devolve vazio para quem está em
--    `chat_bans`, então o banido não lê nem escreve nada, sem tocar no login.
--
-- `chat_messages` e `chat_members` ficam FORA do audit_trigger de propósito
-- (volume alto e conversa privada não viram histórico numa tela genérica de
-- logs; precedente: absenteismo_atestados). `chat_channels` e `chat_bans`
-- entram, porque criar/encerrar grupo e banir são atos administrativos.

create type public.chat_channel_kind as enum ('dm', 'grupo');
create type public.chat_member_role as enum ('dono', 'membro');
create type public.chat_user_status as enum ('disponivel', 'ocupado', 'ausente');

-- ============================================================================
-- Canais
-- ============================================================================
create table public.chat_channels (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  kind       public.chat_channel_kind not null,
  -- nome só existe em grupo; a DM mostra o nome da outra pessoa
  name       text,
  -- 'menor_uuid:maior_uuid', calculado na RPC de criação. É o que impede dois
  -- cliques simultâneos de criarem duas DMs para o mesmo par.
  dm_key     text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  closed_at  timestamptz,
  closed_by  uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_grupo_tem_nome
    check (kind <> 'grupo' or btrim(coalesce(name, '')) <> ''),
  constraint chat_dm_tem_chave
    check ((kind = 'dm') = (dm_key is not null))
);

create unique index chat_channels_dm_uk
  on public.chat_channels (tenant_id, dm_key) where kind = 'dm';
create index chat_channels_tenant_idx on public.chat_channels (tenant_id, created_at desc);

create trigger trg_chat_channels_updated
  before update on public.chat_channels
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Membros
-- ============================================================================
create table public.chat_members (
  channel_id   uuid not null references public.chat_channels(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  role         public.chat_member_role not null default 'membro',
  muted        boolean not null default false,
  -- o "não lido" é por canal, não por mensagem: tudo depois disto é novo
  last_read_at timestamptz not null default now(),
  added_by     uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index chat_members_user_idx on public.chat_members (tenant_id, user_id);

-- ============================================================================
-- Mensagens
-- ============================================================================
create table public.chat_messages (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  channel_id    uuid not null references public.chat_channels(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  -- nulo quando tombstone (apagada); o registro fica, o conteúdo sai
  body          text,
  anexo_path    text,
  anexo_nome    text,
  anexo_mime    text,
  edited_at     timestamptz,
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles(id) on delete set null,
  -- true = removida pela administração; muda o texto do tombstone na tela
  deleted_admin boolean not null default false,
  -- busca avançada; generated para nunca divergir do corpo
  fts tsvector generated always as (to_tsvector('portuguese', coalesce(body, ''))) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint chat_mensagem_tem_conteudo
    check (deleted_at is not null or body is not null or anexo_path is not null),
  constraint chat_tombstone_tem_carimbo
    check ((deleted_at is null) = (deleted_by is null))
);

create index chat_messages_canal_idx on public.chat_messages (channel_id, created_at desc);
create index chat_messages_fts_idx on public.chat_messages using gin (fts);

create trigger trg_chat_messages_updated
  before update on public.chat_messages
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Preferências e bloqueio
-- ============================================================================
create table public.chat_settings (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  -- o liga/desliga do toast; a entrega realtime continua, só o aviso silencia
  notificacoes boolean not null default true,
  -- o status MANUAL. Online/offline é presença efêmera (Realtime Presence);
  -- este campo diz "ocupado/ausente" quando a pessoa está conectada.
  status       public.chat_user_status not null default 'disponivel',
  updated_at   timestamptz not null default now()
);

create trigger trg_chat_settings_updated
  before update on public.chat_settings
  for each row execute function public.set_updated_at();

create table public.chat_bans (
  -- `id` além da PK composta: o audit_trigger lê `new.id` (lição da
  -- 20260809122000, que precisou remendar planner_board_members por isso)
  id         uuid not null default gen_random_uuid() unique,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  banned_by  uuid not null references public.profiles(id) on delete restrict,
  reason     text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- ============================================================================
-- Alcance (molde do Planner: SETOF + SECURITY DEFINER para não reentrar nas
-- policies das próprias tabelas)
-- ============================================================================
create or replace function public.my_chat_channel_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  -- membro E não banido: o ban zera o alcance inteiro de uma vez
  select m.channel_id
    from public.chat_members m
   where m.user_id = (select auth.uid())
     and not exists (
       select 1 from public.chat_bans b
        where b.tenant_id = m.tenant_id and b.user_id = m.user_id);
$$;

revoke execute on function public.my_chat_channel_ids() from public, anon;
grant execute on function public.my_chat_channel_ids() to authenticated;

-- O círculo da administração do chat. Função própria (e não has_tenant_role
-- espalhado) para o dia em que o dono decidir tirar ou pôr um papel: muda aqui.
create or replace function public.is_chat_admin(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[]);
$$;

revoke execute on function public.is_chat_admin(uuid) from public, anon;
grant execute on function public.is_chat_admin(uuid) to authenticated;

create or replace function public.is_chat_banned(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.chat_bans b
     where b.tenant_id = p_tenant and b.user_id = (select auth.uid()));
$$;

revoke execute on function public.is_chat_banned(uuid) from public, anon;
grant execute on function public.is_chat_banned(uuid) to authenticated;

-- ============================================================================
-- RLS e privilégios
-- ============================================================================
alter table public.chat_channels enable row level security;
alter table public.chat_members  enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_settings enable row level security;
alter table public.chat_bans     enable row level security;

-- RLS sem revoke não basta: o ACL padrão concede tudo a anon/authenticated.
revoke all on table public.chat_channels from public, anon, authenticated;
revoke all on table public.chat_members  from public, anon, authenticated;
revoke all on table public.chat_messages from public, anon, authenticated;
revoke all on table public.chat_settings from public, anon, authenticated;
revoke all on table public.chat_bans     from public, anon, authenticated;

-- Canais: leitura por membro OU administração (a auditoria total É esta
-- policy). Escrita nenhuma pela mesa: criar/renomear/encerrar é RPC.
grant select on table public.chat_channels to authenticated;
create policy chat_channels_select on public.chat_channels
  for select to authenticated
  using (id in (select public.my_chat_channel_ids()) or public.is_chat_admin(tenant_id));

-- Membros: leitura pelo mesmo círculo; o único update permitido é a PRÓPRIA
-- linha, e o privilégio de coluna estreita para `muted` e `last_read_at`
-- (papel no grupo e composição são geridos por RPC).
grant select on table public.chat_members to authenticated;
grant update (muted, last_read_at) on table public.chat_members to authenticated;
create policy chat_members_select on public.chat_members
  for select to authenticated
  using (channel_id in (select public.my_chat_channel_ids()) or public.is_chat_admin(tenant_id));
create policy chat_members_update_self on public.chat_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Mensagens: leitura por membro OU administração; INSERT direto pelo autor
-- (é o caminho quente do chat), com o privilégio de coluna impedindo que o
-- cliente carimbe edição/remoção no ato do envio. Sem update/delete: só RPC.
grant select on table public.chat_messages to authenticated;
grant insert (tenant_id, channel_id, author_id, body, anexo_path, anexo_nome, anexo_mime)
  on table public.chat_messages to authenticated;
create policy chat_messages_select on public.chat_messages
  for select to authenticated
  using (channel_id in (select public.my_chat_channel_ids()) or public.is_chat_admin(tenant_id));
create policy chat_messages_insert on public.chat_messages
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and channel_id in (select public.my_chat_channel_ids())
    and not public.is_chat_banned(tenant_id)
    and exists (
      select 1 from public.chat_channels c
       where c.id = channel_id and c.tenant_id = tenant_id and c.closed_at is null)
  );

-- Preferências: cada um mexe só na própria linha.
grant select, insert, update on table public.chat_settings to authenticated;
create policy chat_settings_self on public.chat_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_tenant_member(tenant_id));

-- Bloqueios: qualquer membro da empresa VÊ (a tela explica por que alguém não
-- responde); escrever é só da administração, por RPC.
grant select on table public.chat_bans to authenticated;
create policy chat_bans_select on public.chat_bans
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- ============================================================================
-- Auditoria: só os atos administrativos
-- ============================================================================
drop trigger if exists audit_chat_channels on public.chat_channels;
create trigger audit_chat_channels
  after insert or update or delete on public.chat_channels
  for each row execute function public.audit_trigger();

drop trigger if exists audit_chat_bans on public.chat_bans;
create trigger audit_chat_bans
  after insert or update or delete on public.chat_bans
  for each row execute function public.audit_trigger();

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
