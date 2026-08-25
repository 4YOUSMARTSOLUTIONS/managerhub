-- O departamento pessoal disparando o link de recuperação pela ficha.
--
-- A tela conhece o colaborador pelo id, não pelo que ele digitaria no login. Em
-- vez de duplicar a regra de destino (que decide entre o e-mail de contato e o
-- de autenticação, descarta o domínio sintético e recusa quem está desligado),
-- esta função só traduz "id" para o identificador que a outra já sabe resolver.
--
-- Uma cópia da regra seria pior que o trabalho de traduzir: ela sairia de
-- sincronia na primeira vez que alguém ajustasse uma das duas.
create or replace function public.identificador_de_recuperacao(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_id text;
begin
  -- Mesma guarda das demais: só o service role, de dentro do servidor. A action
  -- que chama já exigiu papel do departamento pessoal antes de chegar aqui.
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Sem permissão';
  end if;

  -- Quando o e-mail de autenticação é o sintético, o CPF é o único identificador
  -- que a resolução aceita — e ela recusa o domínio fabricado de propósito.
  select coalesce(
           nullif(btrim(p.email), ''),
           case when u.email like '%@cpf.managerhub.local' then p.cpf else u.email end)
    into v_id
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.id = p_user;

  return v_id;
end;
$$;

revoke execute on function public.identificador_de_recuperacao(uuid) from public, anon, authenticated;

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
