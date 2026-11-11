-- Absenteísmo lançado já com o motivo (LUIZ, 11/11/2026): o gestor que chega
-- com o atestado na mão lança e envia ao RH de uma vez, com UM comunicado só.
-- Esse comunicado tem texto próprio ("Ausência lançada"), e o registro dos
-- envios passa a aceitar o evento 'direto'.

alter table public.absenteismo_emails drop constraint absenteismo_emails_event_check;
alter table public.absenteismo_emails add constraint absenteismo_emails_event_check
  check (event = any (array['aberto', 'confirmado', 'aprovado', 'reprovado', 'reenvio', 'direto']));
