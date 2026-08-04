-- platform_module_flags e o ROTEIRO DE PRODUTO da plataforma: quais modulos
-- existem e quais estao em obra. E informacao comercial da 4YOU, nao do cliente, e
-- estava legivel por qualquer usuario autenticado (a policy era so
-- "auth.uid() is not null"), inclusive de outras empresas.
--
-- Nao da para simplesmente revogar: getModuleAccess le esta tabela em TODA carga
-- de pagina de TODO usuario, para marcar os modulos "em construcao". Revogar
-- direto faria a lista voltar vazia e o aviso sumir calado da interface.
--
-- Entao a tabela fecha para o owner de plataforma, e o app passa a pedir por uma
-- funcao estreita, que devolve SO a lista de chaves em obra. Isso e exatamente o
-- que a interface ja mostra ao usuario ("Em construcao" no menu); o que deixa de
-- vazar e o catalogo completo com o estado de cada modulo.
--
-- Verificado: 4YOU (owner da plataforma) le as 18 linhas; LUIZ (owner da empresa
-- cliente) le 0; membro le 0 mas continua recebendo a lista em obra pela RPC;
-- anonimo e recusado (42501).

create or replace function public.modulos_em_construcao()
returns setof text
language sql stable security definer set search_path to 'public'
as $function$
  -- guarda: precisa de sessao. Nao ha o que escopar por empresa, a informacao e
  -- da plataforma, e o retorno e so a lista que a propria tela ja exibe.
  select f.module_key
  from public.platform_module_flags f
  where (select auth.uid()) is not null
    and f.under_construction;
$function$;

revoke execute on function public.modulos_em_construcao() from public, anon;
grant execute on function public.modulos_em_construcao() to authenticated;

-- leitura da tabela: so owner de plataforma (a escrita ja era assim)
drop policy if exists "platform_module_flags_select" on public.platform_module_flags;
create policy "platform_module_flags_select" on public.platform_module_flags
  for select using ((select public.is_super_admin()));
