-- Chat interno: as portas de criação e a visão geral.
--
-- Criar conversa mexe em DUAS tabelas (canal + membros) e precisa acontecer na
-- mesma transação, com dedup de DM e checagem de que todo mundo é da empresa.
-- Por isso é RPC, e não insert pela mesa (que nem existe: chat_channels não tem
-- policy de escrita).

/**
 * DM com dedup.
 *
 * `dm_key` é 'menor:maior', então dois cliques simultâneos no mesmo par caem
 * no unique parcial e o segundo recebe o canal que o primeiro criou. Reabrir
 * conversa é o MESMO gesto que criar: quem chama nunca precisa saber se ela
 * já existia.
 */
create or replace function public.chat_criar_dm(p_tenant uuid, p_alvo uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me  uuid := (select auth.uid());
  v_key text;
  v_id  uuid;
begin
  if v_me is null or not public.is_tenant_member(p_tenant) then
    raise exception 'Sem acesso a esta empresa.';
  end if;
  if public.is_chat_banned(p_tenant) then
    raise exception 'Seu acesso ao chat foi bloqueado pela administração.';
  end if;
  if p_alvo = v_me then
    raise exception 'Escolha outra pessoa para conversar.';
  end if;
  if not exists (
    select 1 from public.memberships m
     where m.tenant_id = p_tenant and m.user_id = p_alvo and m.is_active
  ) then
    raise exception 'Esta pessoa não está ativa na empresa.';
  end if;

  v_key := least(v_me::text, p_alvo::text) || ':' || greatest(v_me::text, p_alvo::text);

  insert into public.chat_channels (tenant_id, kind, dm_key, created_by)
  values (p_tenant, 'dm', v_key, v_me)
  on conflict (tenant_id, dm_key) where kind = 'dm' do nothing;

  select c.id into v_id from public.chat_channels c
   where c.tenant_id = p_tenant and c.kind = 'dm' and c.dm_key = v_key;

  insert into public.chat_members (channel_id, user_id, tenant_id, added_by)
  values (v_id, v_me, p_tenant, v_me), (v_id, p_alvo, p_tenant, v_me)
  on conflict (channel_id, user_id) do nothing;

  return v_id;
end;
$$;

revoke execute on function public.chat_criar_dm(uuid, uuid) from public, anon;
grant execute on function public.chat_criar_dm(uuid, uuid) to authenticated;

/** Grupo: quem cria vira dono; só entra quem está ativo na empresa. */
create or replace function public.chat_criar_grupo(
  p_tenant uuid, p_nome text, p_membros uuid[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := (select auth.uid());
  v_id uuid;
begin
  if v_me is null or not public.is_tenant_member(p_tenant) then
    raise exception 'Sem acesso a esta empresa.';
  end if;
  if public.is_chat_banned(p_tenant) then
    raise exception 'Seu acesso ao chat foi bloqueado pela administração.';
  end if;
  if coalesce(btrim(p_nome), '') = '' then
    raise exception 'Dê um nome ao grupo.';
  end if;

  insert into public.chat_channels (tenant_id, kind, name, created_by)
  values (p_tenant, 'grupo', btrim(p_nome), v_me)
  returning id into v_id;

  insert into public.chat_members (channel_id, user_id, tenant_id, role, added_by)
  values (v_id, v_me, p_tenant, 'dono', v_me);

  -- convidados: só membros ATIVOS da empresa; id repetido ou o do criador caem
  -- no distinct/filtro sem virar erro
  insert into public.chat_members (channel_id, user_id, tenant_id, role, added_by)
  select distinct v_id, m.user_id, p_tenant, 'membro', v_me
    from public.memberships m
   where m.tenant_id = p_tenant and m.is_active
     and m.user_id = any(p_membros) and m.user_id <> v_me
  on conflict (channel_id, user_id) do nothing;

  return v_id;
end;
$$;

revoke execute on function public.chat_criar_grupo(uuid, text, uuid[]) from public, anon;
grant execute on function public.chat_criar_grupo(uuid, text, uuid[]) to authenticated;

/**
 * A visão geral da lista de conversas, numa consulta só.
 *
 * A lista precisa de última mensagem + não lidas de CADA canal; montar isso no
 * app seria uma consulta por canal. `security definer` com o alcance explícito
 * `my_chat_channel_ids()`: devolve SÓ os canais de quem chama (a visão de
 * administração, que enxerga tudo, é outra função, na leva de administração).
 */
create or replace function public.chat_overview()
returns table (
  channel_id uuid,
  kind public.chat_channel_kind,
  name text,
  closed_at timestamptz,
  role public.chat_member_role,
  muted boolean,
  last_read_at timestamptz,
  unread bigint,
  membros jsonb,
  last_body text,
  last_author uuid,
  last_at timestamptz,
  last_deleted boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    c.id,
    c.kind,
    c.name,
    c.closed_at,
    me.role,
    me.muted,
    me.last_read_at,
    (select count(*) from public.chat_messages x
      where x.channel_id = c.id
        and x.created_at > me.last_read_at
        and x.author_id <> (select auth.uid())
        and x.deleted_at is null),
    (select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name)
       from public.chat_members m2
       join public.profiles p on p.id = m2.user_id
      where m2.channel_id = c.id),
    ult.body, ult.author_id, ult.created_at, ult.deleted_at is not null
  from public.chat_channels c
  join public.chat_members me
    on me.channel_id = c.id and me.user_id = (select auth.uid())
  left join lateral (
    select x.body, x.author_id, x.created_at, x.deleted_at
      from public.chat_messages x
     where x.channel_id = c.id
     order by x.created_at desc
     limit 1
  ) ult on true
  where c.id in (select public.my_chat_channel_ids())
  order by coalesce(ult.created_at, c.created_at) desc;
$$;

revoke execute on function public.chat_overview() from public, anon;
grant execute on function public.chat_overview() to authenticated;

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
