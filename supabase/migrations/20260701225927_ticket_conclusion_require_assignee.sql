create or replace function public.ticket_request_conclusion(p_ticket uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_tenant uuid; v_status public.ticket_status; v_assignee uuid; v_uid uuid := auth.uid(); v_can boolean;
begin
  select tenant_id, status, assignee_id into v_tenant, v_status, v_assignee from public.tickets where id = p_ticket;
  if v_tenant is null then raise exception 'Chamado não encontrado'; end if;
  if not public.is_tenant_member(v_tenant) then raise exception 'Sem permissão'; end if;
  v_can := public.has_tenant_role(v_tenant, array['owner','admin']::member_role[])
        or exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = v_uid and m.is_ticket_manager);
  if not v_can then raise exception 'Apenas gestores de chamado podem concluir'; end if;
  if v_status in ('resolved','closed','cancelled') then raise exception 'Chamado já finalizado'; end if;
  if v_assignee is null then raise exception 'Atribua um responsável antes de concluir o chamado.'; end if;
  if not exists (select 1 from public.ticket_comments where ticket_id = p_ticket) then
    raise exception 'Registre ao menos um comentário/tratamento antes de concluir.';
  end if;
  update public.tickets set approval_requested_at = now(), updated_at = now() where id = p_ticket;
end; $$;
