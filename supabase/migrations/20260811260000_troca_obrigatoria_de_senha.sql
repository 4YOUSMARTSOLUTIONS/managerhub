-- Troca obrigatória da senha definida por terceiro.
--
-- Hoje 985 dos 988 usuários ainda estão com a senha padrão da importação em
-- lote: qualquer colaborador que a conheça entra na conta de qualquer colega.
-- Quem teve a senha escolhida por outra pessoa (cadastro individual, importação
-- ou reset por admin) passa a ser obrigado a definir uma senha própria antes de
-- usar qualquer tela.
--
-- A pendência mora em `auth.users.raw_app_meta_data`, e NÃO numa coluna de
-- `profiles`, por três motivos:
--
-- 1. `profiles_self_select` libera a linha do colega dentro da empresa, e a
--    chave anon está no bundle do navegador. Uma coluna `must_change_password`
--    legível daria a qualquer funcionário a LISTA NOMINAL de quem ainda usa a
--    senha padrão, que é pior do que o problema original.
-- 2. O gate precisa ser lido no proxy, que roda em toda requisição. Em
--    `app_metadata` a pendência viaja dentro do JWT e é lida sem ida ao banco,
--    respeitando a razão pela qual o middleware já usa `getClaims` e não
--    `getUser`.
-- 3. `auth.users` não é alcançável pelo PostgREST: não há grant de coluna nem
--    policy para errar, e a escrita passa obrigatoriamente por SECURITY DEFINER.
--
-- Contrapartida aceita: a claim é uma cópia com validade de um TTL de token.
-- Quem fecha essa janela é `minha_troca_pendente`, lida no layout autenticado.

-- Leitura autoritativa. Sem parâmetro de propósito: não é oráculo sobre
-- terceiro, responde só por auth.uid().
create or replace function public.minha_troca_pendente()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select (u.raw_app_meta_data ->> 'must_change_password')::boolean
       from auth.users u
      where u.id = (select auth.uid())),
    false)
  and (select auth.uid()) is not null;
$$;

revoke execute on function public.minha_troca_pendente() from public, anon;
grant execute on function public.minha_troca_pendente() to authenticated;

-- Marca a pendência. Helper interno: quem chama são as funções de criação de
-- conta e o reset por admin, por dentro. Daí o revoke de `authenticated`.
create or replace function public.marcar_troca_pendente(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_user is null then raise exception 'Usuário não informado'; end if;
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('must_change_password', true),
         updated_at = now()
   where id = p_user;
end;
$$;

revoke execute on function public.marcar_troca_pendente(uuid) from public, anon, authenticated;

-- Limpa a pendência. Também FORA do alcance de `authenticated`: se existisse
-- uma RPC de limpar chamável com a chave do navegador, o usuário obrigado a
-- trocar a senha limparia a própria pendência pelo PostgREST e nada disto
-- valeria. Quem chama é a server action, com service role, DEPOIS de a senha
-- ter sido de fato trocada.
--
-- Remove a chave em vez de gravar `false`: assim ela some do JWT em vez de
-- virar peso morto em todo token emitido daqui para a frente.
create or replace function public.concluir_troca_de_senha(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_user is null then raise exception 'Usuário não informado'; end if;
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'must_change_password',
         updated_at = now()
   where id = p_user;
end;
$$;

revoke execute on function public.concluir_troca_de_senha(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- regra do AGENTS.md: nenhuma SECURITY DEFINER de public alcançável por anon
do $$
declare n int;
begin
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n <> 0 then raise exception 'secdef executável por anon: %', n; end if;
end $$;
