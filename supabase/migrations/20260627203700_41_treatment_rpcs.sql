
-- contexto comum: carrega dados da demanda
-- (usado dentro de cada RPC via SELECT)

-- Comentar
create or replace function public.demanda_comment(p_demanda uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_action uuid; v_requester uuid; v_uid uuid := auth.uid(); v_rec uuid[]; v_desc text;
begin
  select d.tenant_id, d.action_id, a.requester_id, d.description into v_tenant, v_action, v_requester, v_desc
  from action_demandas d join actions a on a.id = d.action_id where d.id = p_demanda;
  if v_tenant is null then raise exception 'Ação não encontrada'; end if;
  if not public.is_tenant_member(v_tenant) then raise exception 'Sem permissão'; end if;
  if coalesce(trim(p_body),'') = '' then raise exception 'Comentário vazio'; end if;

  insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body)
  values (v_tenant, p_demanda, 'comment', v_uid, trim(p_body));

  v_rec := array(select distinct x from unnest(
      array(select user_id from action_demanda_assignees where demanda_id = p_demanda)
      || array[v_requester]
      || array(select user_id from action_cc where action_id = v_action)) x
    where x is not null and x <> v_uid);
  perform public.notify_users(v_tenant, v_rec, 'comment', 'Novo comentário', v_desc, p_demanda);
end; $$;

-- Alterar status (apenas progresso: open/in_progress/blocked)
create or replace function public.demanda_set_status(p_demanda uuid, p_status public.action_status)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_action uuid; v_requester uuid; v_uid uuid := auth.uid(); v_old public.action_status; v_desc text; v_assignees uuid[]; v_rec uuid[];
begin
  select d.tenant_id, d.action_id, a.requester_id, d.status, d.description into v_tenant, v_action, v_requester, v_old, v_desc
  from action_demandas d join actions a on a.id = d.action_id where d.id = p_demanda;
  if v_tenant is null then raise exception 'Ação não encontrada'; end if;
  v_assignees := array(select user_id from action_demanda_assignees where demanda_id = p_demanda);
  if not (v_uid = any(v_assignees) or public.has_tenant_role(array['owner','admin']::public.member_role[], v_tenant)) then
    raise exception 'Apenas o responsável ou um administrador pode alterar o status';
  end if;
  if p_status not in ('open','in_progress','blocked') then
    raise exception 'Conclusão e cancelamento têm fluxo próprio';
  end if;

  update action_demandas set status = p_status, completed_at = null where id = p_demanda;
  insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, meta)
  values (v_tenant, p_demanda, 'status_changed', v_uid, jsonb_build_object('from', v_old, 'to', p_status));

  v_rec := array(select distinct x from unnest(v_assignees || array[v_requester]) x where x is not null and x <> v_uid);
  perform public.notify_users(v_tenant, v_rec, 'status', 'Status atualizado', v_desc, p_demanda);
end; $$;

-- Solicitar (prazo / conclusão) — só responsável
create or replace function public.demanda_request(p_demanda uuid, p_type text, p_new_due date, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_action uuid; v_requester uuid; v_uid uuid := auth.uid(); v_due date; v_desc text; v_status public.action_status;
begin
  select d.tenant_id, d.action_id, a.requester_id, d.due_date, d.description, d.status
  into v_tenant, v_action, v_requester, v_due, v_desc, v_status
  from action_demandas d join actions a on a.id = d.action_id where d.id = p_demanda;
  if v_tenant is null then raise exception 'Ação não encontrada'; end if;
  if not exists (select 1 from action_demanda_assignees where demanda_id = p_demanda and user_id = v_uid) then
    raise exception 'Apenas o responsável pode solicitar';
  end if;
  if v_status in ('done','cancelled') then raise exception 'Esta ação já foi finalizada'; end if;
  if p_type not in ('prazo','conclusao') then raise exception 'Tipo inválido'; end if;
  if p_type = 'prazo' then
    if p_new_due is null then raise exception 'Informe o novo prazo'; end if;
    if p_new_due <= coalesce(v_due, current_date) then raise exception 'O novo prazo deve ser posterior ao prazo atual'; end if;
  end if;

  insert into public.demanda_requests (tenant_id, demanda_id, type, requested_by, new_due_date, note)
  values (v_tenant, p_demanda, p_type, v_uid, case when p_type='prazo' then p_new_due end, nullif(trim(p_note),''));

  insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body, meta)
  values (v_tenant, p_demanda, p_type || '_requested', v_uid, nullif(trim(p_note),''),
          case when p_type='prazo' then jsonb_build_object('new_due_date', p_new_due) else '{}'::jsonb end);

  perform public.notify_users(v_tenant, array[v_requester], 'request',
    case when p_type='prazo' then 'Pedido de prorrogação' else 'Pedido de conclusão' end, v_desc, p_demanda);
exception when unique_violation then
  raise exception 'Já existe um pedido pendente deste tipo para esta ação';
end; $$;

-- Decidir pedido (aprovar/reprovar) — só o solicitante da ação
create or replace function public.demanda_decide(p_request uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_demanda uuid; v_type text; v_new_due date; v_req_by uuid; v_uid uuid := auth.uid(); v_requester uuid; v_desc text;
begin
  select r.tenant_id, r.demanda_id, r.type, r.new_due_date, r.requested_by
  into v_tenant, v_demanda, v_type, v_new_due, v_req_by
  from demanda_requests r where r.id = p_request and r.status = 'pending';
  if v_tenant is null then raise exception 'Pedido não encontrado ou já decidido'; end if;
  select a.requester_id, d.description into v_requester, v_desc
  from action_demandas d join actions a on a.id = d.action_id where d.id = v_demanda;
  if v_uid <> v_requester then raise exception 'Apenas o solicitante da ação pode aprovar'; end if;

  update demanda_requests set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = v_uid, decided_at = now(), decision_note = nullif(trim(p_note),'')
  where id = p_request;

  if p_approve and v_type = 'prazo' then
    update action_demandas set due_date = v_new_due where id = v_demanda;
  elsif p_approve and v_type = 'conclusao' then
    update action_demandas set status = 'done', completed_at = now() where id = v_demanda;
  end if;

  insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body, meta)
  values (v_tenant, v_demanda, v_type || (case when p_approve then '_approved' else '_rejected' end), v_uid,
          nullif(trim(p_note),''), case when v_type='prazo' then jsonb_build_object('new_due_date', v_new_due) else '{}'::jsonb end);

  perform public.notify_users(v_tenant, array[v_req_by], 'decision',
    (case when v_type='prazo' then 'Prorrogação ' else 'Conclusão ' end) || (case when p_approve then 'aprovada' else 'reprovada' end),
    v_desc, v_demanda);
end; $$;

-- Reabrir (solicitante ou admin)
create or replace function public.demanda_reopen(p_demanda uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_requester uuid; v_uid uuid := auth.uid(); v_status public.action_status; v_desc text; v_assignees uuid[];
begin
  select d.tenant_id, a.requester_id, d.status, d.description into v_tenant, v_requester, v_status, v_desc
  from action_demandas d join actions a on a.id = d.action_id where d.id = p_demanda;
  if v_tenant is null then raise exception 'Ação não encontrada'; end if;
  if not (v_uid = v_requester or public.has_tenant_role(array['owner','admin']::public.member_role[], v_tenant)) then
    raise exception 'Apenas o solicitante ou um administrador pode reabrir';
  end if;
  if v_status <> 'done' then raise exception 'Só é possível reabrir ações concluídas'; end if;
  update action_demandas set status = 'in_progress', completed_at = null where id = p_demanda;
  insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body)
  values (v_tenant, p_demanda, 'reopened', v_uid, nullif(trim(p_note),''));
  v_assignees := array(select user_id from action_demanda_assignees where demanda_id = p_demanda);
  perform public.notify_users(v_tenant, array(select x from unnest(v_assignees) x where x <> v_uid), 'reopened', 'Ação reaberta', v_desc, p_demanda);
end; $$;

-- Cancelar (solicitante ou admin)
create or replace function public.demanda_cancel(p_demanda uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_action uuid; v_requester uuid; v_uid uuid := auth.uid(); v_status public.action_status; v_desc text; v_rec uuid[];
begin
  select d.tenant_id, d.action_id, a.requester_id, d.status, d.description into v_tenant, v_action, v_requester, v_status, v_desc
  from action_demandas d join actions a on a.id = d.action_id where d.id = p_demanda;
  if v_tenant is null then raise exception 'Ação não encontrada'; end if;
  if not (v_uid = v_requester or public.has_tenant_role(array['owner','admin']::public.member_role[], v_tenant)) then
    raise exception 'Apenas o solicitante ou um administrador pode cancelar';
  end if;
  if v_status in ('done','cancelled') then raise exception 'Esta ação já foi finalizada'; end if;
  update action_demandas set status = 'cancelled' where id = p_demanda;
  update demanda_requests set status = 'rejected', decided_by = v_uid, decided_at = now() where demanda_id = p_demanda and status = 'pending';
  insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body)
  values (v_tenant, p_demanda, 'cancelled', v_uid, nullif(trim(p_note),''));
  v_rec := array(select distinct x from unnest(array(select user_id from action_demanda_assignees where demanda_id = p_demanda) || array[v_requester]) x where x is not null and x <> v_uid);
  perform public.notify_users(v_tenant, v_rec, 'cancelled', 'Ação cancelada', v_desc, p_demanda);
end; $$;

-- Reatribuir responsáveis (solicitante ou admin)
create or replace function public.demanda_reassign(p_demanda uuid, p_users jsonb, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_requester uuid; v_uid uuid := auth.uid(); v_desc text; v_old uuid[]; v_new uuid[]; v_added uuid[];
begin
  select d.tenant_id, a.requester_id, d.description into v_tenant, v_requester, v_desc
  from action_demandas d join actions a on a.id = d.action_id where d.id = p_demanda;
  if v_tenant is null then raise exception 'Ação não encontrada'; end if;
  if not (v_uid = v_requester or public.has_tenant_role(array['owner','admin']::public.member_role[], v_tenant)) then
    raise exception 'Apenas o solicitante ou um administrador pode reatribuir';
  end if;
  v_old := array(select user_id from action_demanda_assignees where demanda_id = p_demanda);
  v_new := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p_users,'[]'::jsonb)) x);
  delete from action_demanda_assignees where demanda_id = p_demanda;
  insert into action_demanda_assignees (demanda_id, user_id) select p_demanda, u from unnest(v_new) u on conflict do nothing;
  insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body, meta)
  values (v_tenant, p_demanda, 'reassigned', v_uid, nullif(trim(p_note),''), jsonb_build_object('users', to_jsonb(v_new)));
  v_added := array(select x from unnest(v_new) x where x <> all(v_old) and x <> v_uid);
  perform public.notify_users(v_tenant, v_added, 'reassigned', 'Você foi designado responsável', v_desc, p_demanda);
end; $$;

revoke all on function public.demanda_comment(uuid, text), public.demanda_set_status(uuid, public.action_status),
  public.demanda_request(uuid, text, date, text), public.demanda_decide(uuid, boolean, text),
  public.demanda_reopen(uuid, text), public.demanda_cancel(uuid, text), public.demanda_reassign(uuid, jsonb, text)
  from public, anon;
grant execute on function public.demanda_comment(uuid, text), public.demanda_set_status(uuid, public.action_status),
  public.demanda_request(uuid, text, date, text), public.demanda_decide(uuid, boolean, text),
  public.demanda_reopen(uuid, text), public.demanda_cancel(uuid, text), public.demanda_reassign(uuid, jsonb, text)
  to authenticated;

notify pgrst, 'reload schema';

