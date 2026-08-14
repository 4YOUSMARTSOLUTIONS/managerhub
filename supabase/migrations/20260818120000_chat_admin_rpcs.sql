-- Chat interno: administração.
--
-- Gestão de grupo (renomear, encerrar/reabrir, transferir dono, membros) pelo
-- DONO do grupo ou pela administração do chat (owner/admin/hr, is_chat_admin);
-- remoção de mensagem pela administração (tombstone deleted_admin, o texto na
-- tela muda); bloqueio de usuário no chat sem mexer no login; e a visão de
-- TODAS as conversas da empresa para a administração (a RLS de select já dá o
-- alcance, esta RPC só monta a lista numa consulta só).

/** Dono do grupo ou administração: a guarda comum da gestão de grupo. */
create or replace function public.chat_pode_gerir(p_canal uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.chat_channels c
     where c.id = p_canal
       and (
         public.is_chat_admin(c.tenant_id)
         or exists (
           select 1 from public.chat_members m
            where m.channel_id = c.id
              and m.user_id = (select auth.uid())
              and m.role = 'dono'
         )
       )
  );
$$;

-- helper interno: só as RPCs abaixo chamam (a verificação roda sob o dono)
revoke execute on function public.chat_pode_gerir(uuid) from public, anon, authenticated;

create or replace function public.chat_renomear_grupo(p_id uuid, p_nome text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_kind public.chat_channel_kind;
begin
  select kind into v_kind from public.chat_channels where id = p_id;
  if v_kind is null then
    raise exception 'Conversa não encontrada.';
  end if;
  if v_kind <> 'grupo' then
    raise exception 'Só grupos têm nome.';
  end if;
  if not public.chat_pode_gerir(p_id) then
    raise exception 'Só o dono do grupo ou a administração podem fazer isso.';
  end if;
  if btrim(coalesce(p_nome, '')) = '' then
    raise exception 'Dê um nome ao grupo.';
  end if;

  update public.chat_channels
     set name = btrim(p_nome), updated_at = now()
   where id = p_id;
end;
$$;

revoke execute on function public.chat_renomear_grupo(uuid, text) from public, anon;
grant execute on function public.chat_renomear_grupo(uuid, text) to authenticated;

/** Encerrar congela o grupo (ninguém escreve); reabrir desfaz. */
create or replace function public.chat_encerrar_grupo(p_id uuid, p_encerrar boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_kind public.chat_channel_kind;
begin
  select kind into v_kind from public.chat_channels where id = p_id;
  if v_kind is null then
    raise exception 'Conversa não encontrada.';
  end if;
  if v_kind <> 'grupo' then
    raise exception 'Só grupos podem ser encerrados.';
  end if;
  if not public.chat_pode_gerir(p_id) then
    raise exception 'Só o dono do grupo ou a administração podem fazer isso.';
  end if;

  update public.chat_channels
     set closed_at = case when p_encerrar then now() else null end,
         closed_by = case when p_encerrar then (select auth.uid()) else null end,
         updated_at = now()
   where id = p_id;
end;
$$;

revoke execute on function public.chat_encerrar_grupo(uuid, boolean) from public, anon;
grant execute on function public.chat_encerrar_grupo(uuid, boolean) to authenticated;

create or replace function public.chat_transferir_dono(p_id uuid, p_novo uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_kind public.chat_channel_kind;
begin
  select kind into v_kind from public.chat_channels where id = p_id;
  if v_kind is null then
    raise exception 'Conversa não encontrada.';
  end if;
  if v_kind <> 'grupo' then
    raise exception 'Só grupos têm dono.';
  end if;
  if not public.chat_pode_gerir(p_id) then
    raise exception 'Só o dono do grupo ou a administração podem fazer isso.';
  end if;
  if not exists (
    select 1 from public.chat_members m where m.channel_id = p_id and m.user_id = p_novo
  ) then
    raise exception 'A pessoa precisa ser participante do grupo.';
  end if;

  update public.chat_members set role = 'membro' where channel_id = p_id and role = 'dono';
  update public.chat_members set role = 'dono'   where channel_id = p_id and user_id = p_novo;
end;
$$;

revoke execute on function public.chat_transferir_dono(uuid, uuid) from public, anon;
grant execute on function public.chat_transferir_dono(uuid, uuid) to authenticated;

/**
 * Entra e sai gente do grupo numa chamada só. Quem entra precisa estar ativo
 * na empresa; o dono não sai por aqui (transfira antes). Remover alguém apaga
 * o vínculo, e com ele o acesso ao histórico (decisão da leva 1: fora do
 * canal, fora do conteúdo).
 */
create or replace function public.chat_gerir_membros(p_id uuid, p_adicionar uuid[], p_remover uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_canal public.chat_channels%rowtype;
begin
  select * into v_canal from public.chat_channels where id = p_id;
  if v_canal.id is null then
    raise exception 'Conversa não encontrada.';
  end if;
  if v_canal.kind <> 'grupo' then
    raise exception 'Membros só se gerenciam em grupos.';
  end if;
  if not public.chat_pode_gerir(p_id) then
    raise exception 'Só o dono do grupo ou a administração podem fazer isso.';
  end if;
  if exists (
    select 1 from public.chat_members m
     where m.channel_id = p_id and m.role = 'dono' and m.user_id = any(coalesce(p_remover, '{}'))
  ) then
    raise exception 'Transfira o dono antes de removê-lo do grupo.';
  end if;

  insert into public.chat_members (channel_id, user_id, tenant_id, added_by)
  select p_id, u, v_canal.tenant_id, (select auth.uid())
    from unnest(coalesce(p_adicionar, '{}')) as u
   where exists (
     select 1 from public.memberships ms
      where ms.tenant_id = v_canal.tenant_id and ms.user_id = u and ms.is_active
   )
  on conflict (channel_id, user_id) do nothing;

  delete from public.chat_members
   where channel_id = p_id and user_id = any(coalesce(p_remover, '{}'));
end;
$$;

revoke execute on function public.chat_gerir_membros(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.chat_gerir_membros(uuid, uuid[], uuid[]) to authenticated;

/** Tombstone da administração: o texto na tela é outro, e fica registrado quem removeu. */
create or replace function public.chat_apagar_mensagem_admin(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_msg public.chat_messages%rowtype;
begin
  select * into v_msg from public.chat_messages where id = p_id;
  if v_msg.id is null then
    raise exception 'Mensagem não encontrada.';
  end if;
  if not public.is_chat_admin(v_msg.tenant_id) then
    raise exception 'Só a administração pode remover mensagens dos outros.';
  end if;
  if v_msg.deleted_at is not null then
    return; -- já apagada: idempotente
  end if;

  update public.chat_messages
     set body = null,
         anexo_path = null, anexo_nome = null, anexo_mime = null,
         deleted_at = now(), deleted_by = (select auth.uid()), deleted_admin = true,
         updated_at = now()
   where id = p_id;
end;
$$;

revoke execute on function public.chat_apagar_mensagem_admin(uuid) from public, anon;
grant execute on function public.chat_apagar_mensagem_admin(uuid) to authenticated;

/**
 * Bloqueio no chat: a pessoa continua logando, mas my_chat_channel_ids()
 * devolve vazio (não lê) e a policy de insert recusa (não escreve).
 */
create or replace function public.chat_banir(p_tenant uuid, p_user uuid, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_chat_admin(p_tenant) then
    raise exception 'Só a administração pode bloquear alguém no chat.';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'Você não pode bloquear a si.';
  end if;
  if not exists (
    select 1 from public.memberships ms
     where ms.tenant_id = p_tenant and ms.user_id = p_user
  ) then
    raise exception 'Esta pessoa não é da empresa.';
  end if;

  insert into public.chat_bans (tenant_id, user_id, banned_by, reason)
  values (p_tenant, p_user, (select auth.uid()), nullif(btrim(coalesce(p_motivo, '')), ''))
  on conflict (tenant_id, user_id) do nothing;
end;
$$;

revoke execute on function public.chat_banir(uuid, uuid, text) from public, anon;
grant execute on function public.chat_banir(uuid, uuid, text) to authenticated;

create or replace function public.chat_desbanir(p_tenant uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_chat_admin(p_tenant) then
    raise exception 'Só a administração pode desbloquear alguém no chat.';
  end if;
  delete from public.chat_bans where tenant_id = p_tenant and user_id = p_user;
end;
$$;

revoke execute on function public.chat_desbanir(uuid, uuid) from public, anon;
grant execute on function public.chat_desbanir(uuid, uuid) to authenticated;

/**
 * Todas as conversas da empresa, para a aba de administração. A RLS de select
 * já libera o conteúdo ao is_chat_admin; esta função só evita uma consulta
 * por canal para montar a lista. Sem unread/muted: administração não é membro.
 */
create or replace function public.chat_overview_admin(p_tenant uuid)
returns table (
  channel_id uuid,
  kind public.chat_channel_kind,
  name text,
  closed_at timestamptz,
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
    (select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name)
       from public.chat_members m2
       join public.profiles p on p.id = m2.user_id
      where m2.channel_id = c.id),
    ult.body, ult.author_id, ult.created_at, ult.deleted_at is not null
  from public.chat_channels c
  left join lateral (
    select x.body, x.author_id, x.created_at, x.deleted_at
      from public.chat_messages x
     where x.channel_id = c.id
     order by x.created_at desc
     limit 1
  ) ult on true
  where c.tenant_id = p_tenant
    and public.is_chat_admin(p_tenant)   -- guarda: sem papel, lista vazia
  order by coalesce(ult.created_at, c.created_at) desc;
$$;

revoke execute on function public.chat_overview_admin(uuid) from public, anon;
grant execute on function public.chat_overview_admin(uuid) to authenticated;

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
