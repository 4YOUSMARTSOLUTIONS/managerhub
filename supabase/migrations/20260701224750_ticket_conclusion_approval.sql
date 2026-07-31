alter table public.tickets add column if not exists approval_requested_at timestamptz;

-- gestor de chamado solicita a conclusão (fica "aguardando de acordo do solicitante")
create or replace function public.ticket_request_conclusion(p_ticket uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_tenant uuid; v_status public.ticket_status; v_uid uuid := auth.uid(); v_can boolean;
begin
  select tenant_id, status into v_tenant, v_status from public.tickets where id = p_ticket;
  if v_tenant is null then raise exception 'Chamado não encontrado'; end if;
  if not public.is_tenant_member(v_tenant) then raise exception 'Sem permissão'; end if;
  v_can := public.has_tenant_role(v_tenant, array['owner','admin']::member_role[])
        or exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = v_uid and m.is_ticket_manager);
  if not v_can then raise exception 'Apenas gestores de chamado podem concluir'; end if;
  if v_status in ('resolved','closed','cancelled') then raise exception 'Chamado já finalizado'; end if;
  if not exists (select 1 from public.ticket_comments where ticket_id = p_ticket) then
    raise exception 'Registre ao menos um comentário/tratamento antes de concluir.';
  end if;
  update public.tickets set approval_requested_at = now(), updated_at = now() where id = p_ticket;
end; $$;

-- solicitante dá o "de acordo" (aprova => Resolvido) ou recusa (=> Em atendimento + comentário)
create or replace function public.ticket_decide_conclusion(p_ticket uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_tenant uuid; v_requester uuid; v_req_at timestamptz; v_uid uuid := auth.uid();
begin
  select tenant_id, requester_id, approval_requested_at into v_tenant, v_requester, v_req_at from public.tickets where id = p_ticket;
  if v_tenant is null then raise exception 'Chamado não encontrado'; end if;
  if v_req_at is null then raise exception 'Este chamado não está aguardando de acordo'; end if;
  if v_uid is distinct from v_requester then raise exception 'Apenas o solicitante pode aprovar ou recusar'; end if;

  if p_approve then
    update public.tickets set status = 'resolved', resolved_at = now(), approval_requested_at = null, updated_at = now() where id = p_ticket;
  else
    update public.tickets set status = 'in_progress', approval_requested_at = null, updated_at = now() where id = p_ticket;
    if nullif(trim(p_note), '') is not null then
      insert into public.ticket_comments (ticket_id, author_id, body)
      values (p_ticket, v_uid, 'Reabertura (recusou a conclusão): ' || trim(p_note));
    end if;
  end if;
end; $$;

notify pgrst, 'reload schema';
