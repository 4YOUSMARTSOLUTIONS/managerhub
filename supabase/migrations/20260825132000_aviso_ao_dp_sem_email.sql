-- Quem pediu recuperação e não tem e-mail cadastrado vira aviso ao departamento
-- pessoal.
--
-- Sem isto a pessoa fica num beco: a tela responde a mesma coisa para todo mundo
-- (é o que impede descobrir quem existe na base), ela nunca recebe o e-mail, e
-- ninguém fica sabendo que ela travou. São 66 colaboradores ativos nessa
-- situação hoje. O aviso fecha o ciclo pelo lado de dentro, sem afrouxar nada do
-- lado de fora.
--
-- O dedup de 24h existe porque o freio da recuperação permite 3 pedidos a cada
-- 15 minutos: sem ele, uma pessoa insistindo viraria enxurrada no sino do RH.

create or replace function public.recuperacao_avisar_dp(p_user uuid, p_tenant uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_nome text;
  v_dp uuid[];
  v_corpo text;
begin
  -- Mesma guarda das demais funções pré-login: só o service role, de dentro do
  -- servidor. Não há `auth.uid()` neste caminho.
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Sem permissão';
  end if;

  if p_user is null or p_tenant is null then
    return;
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), 'Um colaborador')
    into v_nome
    from public.profiles p where p.id = p_user;

  v_corpo := v_nome || ' tentou recuperar a senha, mas não tem e-mail cadastrado. '
             || 'Cadastre o e-mail na ficha ou redefina a senha em Configurações, na aba Colaboradores.';

  if exists (
    select 1 from public.notifications n
     where n.tenant_id = p_tenant
       and n.type = 'senha_sem_email'
       and n.body = v_corpo
       and n.created_at > now() - interval '24 hours') then
    return;
  end if;

  select array_agg(m.user_id) into v_dp
    from public.memberships m
   where m.tenant_id = p_tenant
     and m.role in ('owner', 'admin', 'hr')
     and m.is_active;

  if v_dp is null then
    return;
  end if;

  -- `notify_users_sistema` e não `notify_users`: esta guarda pelo CHAMADOR ser
  -- membro da empresa, e aqui não há chamador nenhum (a pessoa não está logada).
  perform public.notify_users_sistema(
    p_tenant, v_dp, 'senha_sem_email',
    'Recuperação de senha sem e-mail', v_corpo);
end;
$$;

revoke execute on function public.recuperacao_avisar_dp(uuid, uuid) from public, anon, authenticated;

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
