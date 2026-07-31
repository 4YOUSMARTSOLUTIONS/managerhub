
create or replace function public.demanda_set_status(p_demanda uuid, p_status public.action_status)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_action uuid; v_requester uuid; v_uid uuid := auth.uid(); v_old public.action_status; v_desc text; v_assignees uuid[]; v_rec uuid[];
begin
  select d.tenant_id, d.action_id, a.requester_id, d.status, d.description into v_tenant, v_action, v_requester, v_old, v_desc
  from action_demandas d join actions a on a.id = d.action_id where d.id = p_demanda;
  if v_tenant is null then raise exception 'Ação não encontrada'; end if;
  v_assignees := array(select user_id from action_demanda_assignees where demanda_id = p_demanda);
  if not (v_uid = any(v_assignees) or public.has_tenant_role(v_tenant, array['owner','admin']::public.member_role[])) then
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

create or replace function public.demanda_reopen(p_demanda uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_requester uuid; v_uid uuid := auth.uid(); v_status public.action_status; v_desc text; v_assignees uuid[];
begin
  select d.tenant_id, a.requester_id, d.status, d.description into v_tenant, v_requester, v_status, v_desc
  from action_demandas d join actions a on a.id = d.action_id where d.id = p_demanda;
  if v_tenant is null then raise exception 'Ação não encontrada'; end if;
  if not (v_uid = v_requester or public.has_tenant_role(v_tenant, array['owner','admin']::public.member_role[])) then
    raise exception 'Apenas o solicitante ou um administrador pode reabrir';
  end if;
  if v_status <> 'done' then raise exception 'Só é possível reabrir ações concluídas'; end if;
  update action_demandas set status = 'in_progress', completed_at = null where id = p_demanda;
  insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body)
  values (v_tenant, p_demanda, 'reopened', v_uid, nullif(trim(p_note),''));
  v_assignees := array(select user_id from action_demanda_assignees where demanda_id = p_demanda);
  perform public.notify_users(v_tenant, array(select x from unnest(v_assignees) x where x <> v_uid), 'reopened', 'Ação reaberta', v_desc, p_demanda);
end; $$;

create or replace function public.demanda_cancel(p_demanda uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_action uuid; v_requester uuid; v_uid uuid := auth.uid(); v_status public.action_status; v_desc text; v_rec uuid[];
begin
  select d.tenant_id, d.action_id, a.requester_id, d.status, d.description into v_tenant, v_action, v_requester, v_status, v_desc
  from action_demandas d join actions a on a.id = d.action_id where d.id = p_demanda;
  if v_tenant is null then raise exception 'Ação não encontrada'; end if;
  if not (v_uid = v_requester or public.has_tenant_role(v_tenant, array['owner','admin']::public.member_role[])) then
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

create or replace function public.demanda_reassign(p_demanda uuid, p_users jsonb, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_requester uuid; v_uid uuid := auth.uid(); v_desc text; v_old uuid[]; v_new uuid[]; v_added uuid[];
begin
  select d.tenant_id, a.requester_id, d.description into v_tenant, v_requester, v_desc
  from action_demandas d join actions a on a.id = d.action_id where d.id = p_demanda;
  if v_tenant is null then raise exception 'Ação não encontrada'; end if;
  if not (v_uid = v_requester or public.has_tenant_role(v_tenant, array['owner','admin']::public.member_role[])) then
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

notify pgrst, 'reload schema';

