-- Segurança: a natureza do relato, que é o que a pirâmide de Heinrich enxerga.
--
-- O TIPO do relato é catálogo do cliente ("Ato inseguro", "Condição insegura no
-- PDV", "Quase acidente"...), e cada empresa nomeia do seu jeito. A PIRÂMIDE,
-- porém, precisa de camadas fixas: desvio na base, incidente logo acima, e o
-- resto vem dos acidentes. Por isso cada tipo carrega uma natureza, e é a
-- natureza que a estatística conta.
--
-- `positivo` é o comportamento seguro. Ele NÃO entra na pirâmide (a pirâmide
-- conta falha), mas é o indicador que mostra a operação sendo observada; vira
-- card próprio no painel.
--
-- Enum sozinho no arquivo, como manda a lição da 20260807120000: assim os
-- `Record` exaustivos de constants.ts quebram a compilação quando um valor novo
-- aparecer, em vez de sumirem silenciosamente da tela.

create type public.seg_relato_natureza as enum ('desvio', 'incidente', 'positivo');

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
