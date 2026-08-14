-- Chat interno: foto do grupo.
--
-- Mesma régua do avatar de pessoa: bucket PÚBLICO (a foto aparece em toda
-- lista; signed URL por linha não serve), 2 MB, só imagem. Caminho
-- `{tenant_id}/{channel_id}/{ts}.ext`; a ESCRITA é do dono do grupo ou da
-- administração do chat, e a coluna `avatar_path` em chat_channels só muda
-- pela RPC (a tabela segue sem update pela mesa).

alter table public.chat_channels
  add column if not exists avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-grupo-fotos', 'chat-grupo-fotos', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- escrita (subir, trocar, limpar): dono do canal do caminho, ou administração;
-- `name` SEMPRE qualificado (lição da 20260818110000: chat_members também tem
-- colunas que capturariam o nome cru)
drop policy if exists chat_grupo_foto_insert on storage.objects;
create policy chat_grupo_foto_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-grupo-fotos'
    and (
      exists (
        select 1 from public.chat_members m
         where m.channel_id = ((storage.foldername(storage.objects.name))[2])::uuid
           and m.user_id = (select auth.uid()) and m.role = 'dono'
      )
      or public.is_chat_admin(((storage.foldername(storage.objects.name))[1])::uuid)
    )
  );

drop policy if exists chat_grupo_foto_update on storage.objects;
create policy chat_grupo_foto_update on storage.objects for update to authenticated
  using (
    bucket_id = 'chat-grupo-fotos'
    and (
      exists (
        select 1 from public.chat_members m
         where m.channel_id = ((storage.foldername(storage.objects.name))[2])::uuid
           and m.user_id = (select auth.uid()) and m.role = 'dono'
      )
      or public.is_chat_admin(((storage.foldername(storage.objects.name))[1])::uuid)
    )
  );

drop policy if exists chat_grupo_foto_delete on storage.objects;
create policy chat_grupo_foto_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-grupo-fotos'
    and (
      exists (
        select 1 from public.chat_members m
         where m.channel_id = ((storage.foldername(storage.objects.name))[2])::uuid
           and m.user_id = (select auth.uid()) and m.role = 'dono'
      )
      or public.is_chat_admin(((storage.foldername(storage.objects.name))[1])::uuid)
    )
  );

/** Grava (ou limpa, com null) o caminho da foto; dono do grupo ou administração. */
create or replace function public.chat_definir_foto(p_id uuid, p_path text)
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
    raise exception 'Só grupos têm foto.';
  end if;
  if not public.chat_pode_gerir(p_id) then
    raise exception 'Só o dono do grupo ou a administração podem fazer isso.';
  end if;

  update public.chat_channels
     set avatar_path = nullif(btrim(coalesce(p_path, '')), ''),
         updated_at = now()
   where id = p_id;
end;
$$;

revoke execute on function public.chat_definir_foto(uuid, text) from public, anon;
grant execute on function public.chat_definir_foto(uuid, text) to authenticated;

-- ============================================================================
-- Overviews devolvem a foto (mudar o retorno exige drop + recreate)
-- ============================================================================
drop function if exists public.chat_overview();
create function public.chat_overview()
returns table (
  channel_id uuid,
  kind public.chat_channel_kind,
  name text,
  avatar_path text,
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
    c.avatar_path,
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

drop function if exists public.chat_overview_admin(uuid);
create function public.chat_overview_admin(p_tenant uuid)
returns table (
  channel_id uuid,
  kind public.chat_channel_kind,
  name text,
  avatar_path text,
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
    c.avatar_path,
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
