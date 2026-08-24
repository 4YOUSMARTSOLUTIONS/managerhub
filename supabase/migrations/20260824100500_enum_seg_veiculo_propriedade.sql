-- De quem é o veículo que passou na blitz: do colaborador ou da empresa.
-- Importa porque a tratativa muda: pneu careca no veículo próprio é conversa
-- com a pessoa; na frota, é ordem de manutenção.
--
-- Enum sozinho no arquivo, como manda a lição da 20260807120000.

create type public.seg_veiculo_propriedade as enum ('proprio', 'empresa');

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
