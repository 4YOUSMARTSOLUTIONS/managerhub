-- O aviso leva ao item (LUIZ, 25/11/2026): clicar num aviso de chamado abre
-- aquele chamado, e num de ação abre aquela ação, em vez de só a lista.
--
-- A ação já vinha com `demanda_id`; faltava o chamado. A notificação ganha
-- `ticket_id`, e `notify_users` o parâmetro opcional `p_ticket`. Quem abre o
-- item é a tela, com a leitura de quem clicou: guardar o id aqui não dá acesso
-- a nada.

alter table public.notifications
  add column ticket_id uuid references public.tickets(id) on delete set null;

create index notifications_ticket_idx on public.notifications (ticket_id)
  where ticket_id is not null;

-- Parâmetro novo com default: as chamadas de hoje (posicionais, nas funções de
-- ações e segurança, e nomeadas, no app) seguem iguais. Precisa do drop, senão
-- a versão antiga e a nova casariam com a mesma chamada ("not unique").
drop function public.notify_users(uuid, uuid[], text, text, text, uuid, uuid);

create function public.notify_users(
  p_tenant uuid, p_users uuid[], p_type text, p_title text, p_body text,
  p_demanda uuid, p_planner_board uuid default null, p_ticket uuid default null
)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.notifications (tenant_id, user_id, type, title, body, demanda_id, planner_board_id, ticket_id)
  select distinct p_tenant, u, p_type, p_title, p_body, p_demanda, p_planner_board, p_ticket
  from unnest(p_users) u
  where u is not null
    and public.is_tenant_member(p_tenant);
$function$;

revoke execute on function public.notify_users(uuid, uuid[], text, text, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.notify_users(uuid, uuid[], text, text, text, uuid, uuid, uuid) to authenticated, service_role;

-- O aviso no celular leva ao mesmo lugar que o sino: o push precisa do chamado.
-- Mudar as colunas devolvidas exige recriar.
drop function public.push_para_enviar(text, uuid[]);

create function public.push_para_enviar(p_segredo text, p_ids uuid[])
returns table(notification_id uuid, type text, title text, body text, demanda_id uuid, planner_board_id uuid,
              ticket_id uuid, endpoint text, p256dh text, chave_auth text, sessao_viva boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_segredo is null or p_segredo is distinct from (
    select decrypted_secret from vault.decrypted_secrets where name = 'push_webhook_segredo'
  ) then
    raise exception 'Chamada recusada.' using errcode = '42501';
  end if;

  return query
  with reivindicadas as (
    insert into push_enviadas (notification_id)
    select n.id from notifications n
     where n.id = any (p_ids[1:1000]) and n.created_at > now() - interval '15 minutes'
    on conflict do nothing
    returning push_enviadas.notification_id
  )
  select n.id, n.type, n.title, n.body, n.demanda_id, n.planner_board_id, n.ticket_id, s.endpoint, s.p256dh, s.auth,
         -- aparelho parado além do tempo da pessoa: a sessão dela já venceu
         (l.limite is null or s.ativo_em > now() - make_interval(mins => l.limite))
    from reivindicadas r
    join notifications n on n.id = r.notification_id
    join push_inscricoes s on s.user_id = n.user_id
    cross join lateral (select inatividade_de(n.tenant_id, n.user_id) as limite) l;
end $function$;

revoke execute on function public.push_para_enviar(text, uuid[]) from public, anon, authenticated;
grant execute on function public.push_para_enviar(text, uuid[]) to service_role;

-- Os avisos de chamado que já existem trazem o número no título ("Chamado #2172
-- aguardando seu de acordo"): o número é único por empresa, então dá para ligar.
update public.notifications n
   set ticket_id = t.id
  from public.tickets t
 where n.type = 'ticket'
   and n.ticket_id is null
   and t.tenant_id = n.tenant_id
   and ltrim(t.code, '#') = substring(n.title from '#(\d+)');

notify pgrst, 'reload schema';
