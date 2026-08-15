-- A classificação do acidente, no padrão que a indústria usa.
--
--   fai  First Aid Injury: primeiros socorros, sem atendimento médico.
--   mti  Medical Treatment Injury: exigiu médico, sem afastar e sem restrição.
--   mdi  Medical/Duty Injury: exigiu médico e gerou RESTRIÇÃO de atividade,
--        com o colaborador realocado em trabalho compatível.
--   lti  Lost Time Injury: houve afastamento de pelo menos um dia ou turno.
--   sif  Serious Injuries and Fatalities: morte, incapacidade permanente ou
--        lesão que muda a vida da pessoa.
--
-- Estes cinco são FIXOS, e é a única coisa do módulo que o cliente não
-- configura. A pirâmide de Heinrich depende da severidade, e severidade que
-- cada empresa nomeia do seu jeito não empilha: FAI+MTI+MDI formam uma camada,
-- LTI a seguinte e SIF o topo. Sem enum, o topo da pirâmide viraria texto
-- livre.
--
-- Enum sozinho no arquivo, como manda a lição da 20260807120000.

create type public.seg_acidente_class as enum ('fai', 'mti', 'mdi', 'lti', 'sif');

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
