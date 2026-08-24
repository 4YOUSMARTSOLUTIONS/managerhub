-- Típico ou de trajeto: a outra classificação do acidente.
--
-- A severidade (`seg_acidente_class`) responde "quão grave"; esta responde
-- "onde a empresa entra". Típico é o que acontece na operação, dentro do que a
-- empresa controla e pode mudar. Trajeto é o percurso entre a casa e o
-- trabalho, nos dois sentidos: a CAT é a mesma, o afastamento conta igual para
-- o INSS, mas nenhuma mudança de processo interno teria evitado.
--
-- Sem separar, o painel entrega "12 acidentes no ano" e a reunião discute os
-- doze como se fossem a mesma conversa.
--
-- Duas categorias, e não três: doença ocupacional (que a Lei 8.213/91 equipara
-- a acidente) ficou de fora por decisão do cliente. Se entrar depois, é um
-- `alter type ... add value`, barato.
--
-- Enum sozinho no arquivo, como manda a lição da 20260807120000.

create type public.seg_acidente_tipo as enum ('tipico', 'trajeto');

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
