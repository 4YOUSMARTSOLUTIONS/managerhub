-- Chat interno: som e prévia como preferências SEPARADAS.
--
-- `notificacoes` passa a significar só a PRÉVIA (o toast que sobe com o texto
-- e, com a aba oculta, o aviso do navegador); `som` é o alerta sonoro. As
-- quatro combinações valem, e com os dois desligados fica só o contador no
-- balão. O grant de chat_settings é por tabela, então a coluna nova herda o
-- privilégio da policy self sem mais nada.

alter table public.chat_settings
  add column if not exists som boolean not null default true;

comment on column public.chat_settings.notificacoes is
  'Prévia da mensagem: toast na tela e, com a aba oculta, aviso do navegador.';
comment on column public.chat_settings.som is
  'Alerta sonoro de mensagem nova, independente da prévia.';

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
