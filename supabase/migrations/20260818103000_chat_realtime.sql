-- Chat interno: o tempo real.
--
-- PRIMEIRO uso de Supabase Realtime no projeto, e a escolha é BROADCAST FROM
-- DATABASE (realtime.broadcast_changes em trigger), não `postgres_changes`:
--
-- - postgres_changes checa a RLS por ASSINANTE a cada mudança (WALRUS): o
--   custo cresce com o número de conexões e soma latência, e a própria doc
--   sugere migrar para Broadcast;
-- - os filtros de postgres_changes são só eq/in, o que não expressa "todos os
--   meus canais";
-- - DELETE não passa pela RLS. Aqui nunca há DELETE físico (apagar é UPDATE
--   com tombstone), então todo evento chega inteiro.
--
-- O trigger emite para o tópico privado POR USUÁRIO `chat:u:{userId}` de cada
-- membro do canal: uma assinatura por cliente cobre a conversa aberta, os
-- badges e os toasts. Fan-out por membro é barato na escala atual (dezenas de
-- usuários); se um dia houver canais com centenas de pessoas, o caminho é
-- migrar o tópico para `chat:c:{canal}` com policy por membership.

create or replace function public.chat_broadcast_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid;
begin
  for v_user in
    select m.user_id from public.chat_members m where m.channel_id = new.channel_id
  loop
    perform realtime.broadcast_changes(
      'chat:u:' || v_user::text,  -- tópico privado do destinatário
      tg_op,                       -- evento: INSERT ou UPDATE
      tg_op,
      tg_table_name,
      tg_table_schema,
      new,
      old);
  end loop;
  return null;
end;
$$;

revoke execute on function public.chat_broadcast_message() from public, anon, authenticated;

drop trigger if exists trg_chat_messages_broadcast on public.chat_messages;
create trigger trg_chat_messages_broadcast
  after insert or update on public.chat_messages
  for each row execute function public.chat_broadcast_message();

-- ============================================================================
-- Autorização dos canais privados (realtime.messages)
-- ============================================================================
--
-- Canal privado só abre se uma policy nesta tabela deixar. É o que impede
-- alguém de assinar o tópico de OUTRO usuário ou a presença de OUTRA empresa.
-- Sem estas policies o subscribe é recusado (silenciosamente, do lado do
-- cliente: o sintoma é o canal nunca chegar a SUBSCRIBED).

-- broadcast: cada um escuta só o próprio tópico; ninguém PUBLICA pelo
-- websocket (só o banco emite), então não há policy de insert para broadcast
drop policy if exists chat_broadcast_proprio_topico on realtime.messages;
create policy chat_broadcast_proprio_topico on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'chat:u:' || (select auth.uid())::text
  );

-- presença: qualquer membro da empresa entra e lê o canal `chat:presenca:{tenant}`
drop policy if exists chat_presenca_ler on realtime.messages;
create policy chat_presenca_ler on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'presence'
    and realtime.topic() like 'chat:presenca:%'
    and public.is_tenant_member(split_part(realtime.topic(), ':', 3)::uuid)
  );

drop policy if exists chat_presenca_entrar on realtime.messages;
create policy chat_presenca_entrar on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and realtime.topic() like 'chat:presenca:%'
    and public.is_tenant_member(split_part(realtime.topic(), ':', 3)::uuid)
  );

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
