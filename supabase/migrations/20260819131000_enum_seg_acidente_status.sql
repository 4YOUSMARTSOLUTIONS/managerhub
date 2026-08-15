-- O acidente está em apuração ou já foi encerrado.
--
-- Dois valores só. O acidente não tem fluxo de aprovação como a punição: ele
-- ACONTECEU, e o registro existe desde o primeiro minuto. O que muda é se a
-- equipe ainda está apurando (causa, CAT, retorno do afastado) ou se o caso
-- está fechado com tudo preenchido.

create type public.seg_acidente_status as enum ('aberto', 'encerrado');

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
