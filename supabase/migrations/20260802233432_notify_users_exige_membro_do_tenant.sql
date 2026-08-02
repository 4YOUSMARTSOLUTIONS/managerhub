-- notify_users era um insert sem nenhuma guarda: quem tivesse a chave publica podia
-- criar notificacao em qualquer empresa, para qualquer usuario, com o texto que
-- quisesse (phishing com a cara do sistema). Sendo SECURITY DEFINER, a RLS de
-- notifications nao valia por dentro.
--
-- Passa a exigir que quem chama seja membro da empresa alvo. Os 10 chamadores
-- internos (fluxos de demanda) rodam sob o usuario que agiu, entao seguem valendo;
-- nao ha cron chamando esta funcao.

create or replace function public.notify_users(
  p_tenant uuid, p_users uuid[], p_type text, p_title text, p_body text, p_demanda uuid
) returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.notifications (tenant_id, user_id, type, title, body, demanda_id)
  select distinct p_tenant, u, p_type, p_title, p_body, p_demanda
  from unnest(p_users) u
  where u is not null
    and public.is_tenant_member(p_tenant);
$function$;

revoke execute on function public.notify_users(uuid, uuid[], text, text, text, uuid) from public, anon;
