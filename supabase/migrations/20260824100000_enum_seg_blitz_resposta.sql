-- A resposta de uma pergunta da blitz de trajeto.
--
-- 'na' (não se aplica) existe de propósito: a pergunta do capacete não faz
-- sentido para quem veio de carona coberta, e obrigar um sim/não ali só
-- produziria dado sujo. É a mesma razão do 'na' dos checklists.
--
-- Enum sozinho no arquivo, como manda a lição da 20260807120000.

create type public.seg_blitz_resposta as enum ('sim', 'nao', 'na');

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
