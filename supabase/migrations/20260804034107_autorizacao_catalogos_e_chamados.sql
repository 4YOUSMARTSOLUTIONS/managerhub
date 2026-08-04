-- Autorizacao de escrita: as telas travavam, o banco nao.
--
-- 11 catalogos de CONFIGURACAO exigiam apenas is_tenant_member para escrita.
-- Como a anon key esta no bundle do navegador, qualquer funcionario podia apagar
-- um pilar do Programa de Excelencia ou os setores de chamado chamando o PostgREST
-- direto. A restricao existia so na tela de Configuracoes.
--
-- Conferido antes de restringir: nenhuma funcao do banco escreve nesses catalogos,
-- e todas as escritas do app saem da tela de Configuracoes, que ja e admin-only.
-- A LEITURA continua liberada para todo membro: as telas dependem disso.

-- setores de chamado que eu gerencio (espelha managedSectorIds em tickets.ts)
create or replace function public.my_ticket_sector_ids()
returns setof uuid language sql stable security definer set search_path to 'public'
as $function$
  select s.sector_id from public.ticket_manager_sectors s
  where s.user_id = (select auth.uid());
$function$;

revoke execute on function public.my_ticket_sector_ids() from public, anon;

-- ---------- catalogos: escrita so para owner/admin ----------
do $$
declare t text;
begin
  foreach t in array array[
    'sdpo_programas', 'sdpo_pilares', 'sdpo_secoes', 'sdpo_blocos', 'sdpo_itens',
    'action_kpis', 'action_tools',
    'ticket_sectors', 'ticket_categories', 'ticket_slas', 'ticket_manager_sectors'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format($f$
      create policy %I on public.%I for select using (tenant_id in (select public.my_tenant_ids()))
    $f$, t || '_select', t);
    execute format($f$
      create policy %I on public.%I for all
        using (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
        with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
    $f$, t || '_write', t);
  end loop;
end $$;

-- ---------- chamados ----------
-- Antes: uma unica policy `for all` com is_tenant_member. Qualquer membro fechava,
-- reabria e EXCLUIA qualquer chamado da empresa pelo PostgREST.
--
-- A regra abaixo e a mesma que updateTicketTriage ja aplicava no app (owner/admin,
-- ou gestor do setor do chamado), mais o solicitante, que precisa poder avaliar o
-- proprio chamado (NPS).
drop policy if exists "tickets_member_write" on public.tickets;

create policy "tickets_insert" on public.tickets
  for insert with check (tenant_id in (select public.my_tenant_ids()));

create policy "tickets_update" on public.tickets
  for update using (
    tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[]))
    or requester_id = (select auth.uid())
    or sector_id in (select public.my_ticket_sector_ids())
  )
  with check (
    tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[]))
    or requester_id = (select auth.uid())
    or sector_id in (select public.my_ticket_sector_ids())
  );

create policy "tickets_delete" on public.tickets
  for delete using (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));

-- comentarios: havia DUAS policies `for all` redundantes. Escrever continua livre
-- para quem enxerga o chamado; apagar passa a ser do autor ou de owner/admin.
drop policy if exists "ticket_comments_rw" on public.ticket_comments;
drop policy if exists "ticket_comments_member_write" on public.ticket_comments;

create policy "ticket_comments_insert" on public.ticket_comments
  for insert with check (
    exists (select 1 from public.tickets t
            where t.id = ticket_comments.ticket_id
              and t.tenant_id in (select public.my_tenant_ids()))
  );

create policy "ticket_comments_update" on public.ticket_comments
  for update using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

create policy "ticket_comments_delete" on public.ticket_comments
  for delete using (
    author_id = (select auth.uid())
    or exists (select 1 from public.tickets t
               where t.id = ticket_comments.ticket_id
                 and t.tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
  );
