-- Chat interno: anexos e o ciclo de vida da mensagem (editar e apagar).
--
-- Bucket privado `chat-anexos`, caminho <tenant_id>/<channel_id>/<ts>-<nome>.
-- A policy é mais apertada que a dos outros buckets: não basta ser da empresa,
-- o SEGUNDO segmento (o canal) precisa estar em my_chat_channel_ids(), ou o
-- leitor ser administração do chat (que já lê a conversa inteira pela RLS).
-- Sem policy de delete: anexo acompanha a mensagem, e mensagem não some, vira
-- tombstone.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-anexos', 'chat-anexos', false, 10485760, array[
  'image/jpeg','image/png','image/webp','image/gif','image/heic',
  'application/pdf',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain','text/csv'
])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists chat_anexos_select on storage.objects;
create policy chat_anexos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-anexos'
    and (
      ((storage.foldername(name))[2])::uuid in (select public.my_chat_channel_ids())
      or public.is_chat_admin(((storage.foldername(name))[1])::uuid)
    )
  );

-- upload só por membro (my_chat_channel_ids já exclui banido) e com o canal
-- ainda aberto, espelhando a policy de insert de chat_messages.
-- ATENÇÃO: dentro do exists, `name` sem qualificar seria capturado por
-- chat_channels.name (a tabela também tem essa coluna); qualifique sempre.
drop policy if exists chat_anexos_insert on storage.objects;
create policy chat_anexos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-anexos'
    and ((storage.foldername(storage.objects.name))[2])::uuid in (select public.my_chat_channel_ids())
    and exists (
      select 1 from public.chat_channels c
       where c.id = ((storage.foldername(storage.objects.name))[2])::uuid and c.closed_at is null
    )
  );

-- ============================================================================
-- Editar e apagar a própria mensagem
-- ============================================================================
--
-- chat_messages não tem policy nem grant de update: estas RPCs são o ÚNICO
-- caminho de mutação. O broadcast da leva 3 dispara em UPDATE também, então
-- edição e tombstone chegam ao vivo em quem está com a conversa aberta.

create or replace function public.chat_editar_mensagem(p_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me  uuid := (select auth.uid());
  v_msg public.chat_messages%rowtype;
begin
  select * into v_msg from public.chat_messages where id = p_id;
  if v_msg.id is null then
    raise exception 'Mensagem não encontrada.';
  end if;
  if v_msg.author_id is distinct from v_me then
    raise exception 'Só quem escreveu pode editar a mensagem.';
  end if;
  -- quem saiu do canal (ou foi banido) perde o acesso, inclusive ao próprio texto
  if v_msg.channel_id not in (select public.my_chat_channel_ids()) then
    raise exception 'Você não participa mais desta conversa.';
  end if;
  if v_msg.deleted_at is not null then
    raise exception 'A mensagem foi apagada.';
  end if;
  if exists (
    select 1 from public.chat_channels c where c.id = v_msg.channel_id and c.closed_at is not null
  ) then
    raise exception 'Esta conversa foi encerrada.';
  end if;
  if p_body is null or btrim(p_body) = '' then
    raise exception 'Escreva a mensagem.';
  end if;
  if char_length(p_body) > 4000 then
    raise exception 'A mensagem passou de 4000 caracteres.';
  end if;

  update public.chat_messages
     set body = btrim(p_body), edited_at = now(), updated_at = now()
   where id = p_id;
end;
$$;

revoke execute on function public.chat_editar_mensagem(uuid, text) from public, anon;
grant execute on function public.chat_editar_mensagem(uuid, text) to authenticated;

/**
 * Apagar = tombstone: o registro fica (histórico e auditoria enxergam que
 * HOUVE mensagem), o conteúdo sai. Diferente do editar, funciona mesmo com o
 * canal encerrado: remover o próprio conteúdo é um direito que não expira.
 * As colunas de anexo são limpas junto (o tombstone não deve apontar arquivo);
 * o objeto órfão fica no bucket, inalcançável sem o path.
 */
create or replace function public.chat_apagar_mensagem(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me  uuid := (select auth.uid());
  v_msg public.chat_messages%rowtype;
begin
  select * into v_msg from public.chat_messages where id = p_id;
  if v_msg.id is null then
    raise exception 'Mensagem não encontrada.';
  end if;
  if v_msg.author_id is distinct from v_me then
    raise exception 'Só quem escreveu pode apagar a mensagem.';
  end if;
  if v_msg.channel_id not in (select public.my_chat_channel_ids()) then
    raise exception 'Você não participa mais desta conversa.';
  end if;
  if v_msg.deleted_at is not null then
    return; -- já apagada: nada a fazer, sem erro (idempotente)
  end if;

  update public.chat_messages
     set body = null,
         anexo_path = null, anexo_nome = null, anexo_mime = null,
         deleted_at = now(), deleted_by = v_me, deleted_admin = false,
         updated_at = now()
   where id = p_id;
end;
$$;

revoke execute on function public.chat_apagar_mensagem(uuid) from public, anon;
grant execute on function public.chat_apagar_mensagem(uuid) to authenticated;

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
