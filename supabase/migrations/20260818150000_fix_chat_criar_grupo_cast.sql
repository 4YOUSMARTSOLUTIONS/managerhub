-- Correção: criar grupo com participantes quebrava com
--   column "role" is of type chat_member_role but expression is of type text
--
-- Num INSERT ... VALUES o literal 'dono' é inferido para o tipo da coluna,
-- mas num INSERT ... SELECT o literal 'membro' fica como text e o Postgres
-- não faz o cast implícito para o enum. Por isso o dono entrava e o insert
-- dos convidados estourava. Cast explícito resolve; o resto da função é
-- idêntico à 20260818102000.

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
  select distinct v_id, m.user_id, p_tenant, 'membro'::public.chat_member_role, v_me
    from public.memberships m
   where m.tenant_id = p_tenant and m.is_active
     and m.user_id = any(p_membros) and m.user_id <> v_me
  on conflict (channel_id, user_id) do nothing;

  return v_id;
end;
$$;

revoke execute on function public.chat_criar_grupo(uuid, text, uuid[]) from public, anon;
grant execute on function public.chat_criar_grupo(uuid, text, uuid[]) to authenticated;

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
