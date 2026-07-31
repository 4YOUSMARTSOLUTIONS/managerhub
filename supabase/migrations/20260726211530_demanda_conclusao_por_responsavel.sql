-- 1) Colunas de estado por responsável
alter table public.action_demanda_assignees
  add column if not exists done_requested_at timestamptz,
  add column if not exists completed_at timestamptz;

-- 2) Backfill: demandas já concluídas => todos os responsáveis concluídos
update public.action_demanda_assignees s
set completed_at = coalesce(d.completed_at, now()),
    done_requested_at = coalesce(d.completed_at, now())
from public.action_demandas d
where d.id = s.demanda_id and d.status = 'done' and s.completed_at is null;

-- 2b) Backfill: pedidos de conclusão pendentes => "aguardando aprovação" por pessoa
update public.action_demanda_assignees s
set done_requested_at = r.created_at
from public.demanda_requests r
where r.demanda_id = s.demanda_id and r.requested_by = s.user_id
  and r.type = 'conclusao' and r.status = 'pending'
  and s.completed_at is null and s.done_requested_at is null;

-- remove os pedidos de conclusão pendentes (histórico permanece em demanda_events)
delete from public.demanda_requests where type = 'conclusao' and status = 'pending';

-- 3) Helper: fecha a demanda quando TODOS os responsáveis concluíram
create or replace function public.demanda_close_if_all_done(p_demanda uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_total int; v_done int;
begin
  select count(*), count(completed_at) into v_total, v_done
  from public.action_demanda_assignees where demanda_id = p_demanda;
  if v_total > 0 and v_done = v_total then
    update public.action_demandas set status = 'done', completed_at = now()
    where id = p_demanda and status <> 'done';
  end if;
end; $$;

-- 4) Responsável marca "concluí minha parte" (auto-aprova se for o solicitante)
create or replace function public.demanda_assignee_submit(p_demanda uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid; v_requester uuid; v_desc text; v_status public.action_status; v_uid uuid := auth.uid();
begin
  select d.tenant_id, a.requester_id, d.description, d.status
  into v_tenant, v_requester, v_desc, v_status
  from public.action_demandas d join public.actions a on a.id = d.action_id where d.id = p_demanda;
  if v_tenant is null then raise exception 'Ação não encontrada'; end if;
  if v_status in ('done','cancelled') then raise exception 'Esta ação já foi finalizada'; end if;
  if not exists (select 1 from public.action_demanda_assignees where demanda_id = p_demanda and user_id = v_uid) then
    raise exception 'Apenas o responsável pode concluir a própria parte';
  end if;
  if exists (select 1 from public.action_demanda_assignees
             where demanda_id = p_demanda and user_id = v_uid
               and (completed_at is not null or done_requested_at is not null)) then
    raise exception 'Você já concluiu ou enviou sua parte';
  end if;

  if v_uid = v_requester then
    update public.action_demanda_assignees set done_requested_at = now(), completed_at = now()
    where demanda_id = p_demanda and user_id = v_uid;
    insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, meta)
    values (v_tenant, p_demanda, 'conclusao_approved', v_uid, jsonb_build_object('user', v_uid, 'auto', true));
    perform public.demanda_close_if_all_done(p_demanda);
  else
    update public.action_demanda_assignees set done_requested_at = now()
    where demanda_id = p_demanda and user_id = v_uid;
    insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, meta)
    values (v_tenant, p_demanda, 'conclusao_requested', v_uid, jsonb_build_object('user', v_uid));
    perform public.notify_users(v_tenant, array[v_requester], 'request', 'Pedido de conclusão', v_desc, p_demanda);
  end if;
end; $$;

-- 5) Solicitante aprova/reprova a parte de um responsável
create or replace function public.demanda_assignee_decide(p_demanda uuid, p_user uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid; v_requester uuid; v_desc text; v_uid uuid := auth.uid();
begin
  select d.tenant_id, a.requester_id, d.description into v_tenant, v_requester, v_desc
  from public.action_demandas d join public.actions a on a.id = d.action_id where d.id = p_demanda;
  if v_tenant is null then raise exception 'Ação não encontrada'; end if;
  if v_uid <> v_requester then raise exception 'Apenas o solicitante da ação pode aprovar'; end if;
  if not exists (select 1 from public.action_demanda_assignees
                 where demanda_id = p_demanda and user_id = p_user
                   and done_requested_at is not null and completed_at is null) then
    raise exception 'Não há parte aguardando aprovação para este responsável';
  end if;

  if p_approve then
    update public.action_demanda_assignees set completed_at = now()
    where demanda_id = p_demanda and user_id = p_user;
    insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body, meta)
    values (v_tenant, p_demanda, 'conclusao_approved', v_uid, nullif(trim(p_note),''), jsonb_build_object('user', p_user));
    perform public.notify_users(v_tenant, array[p_user], 'decision', 'Conclusão aprovada', v_desc, p_demanda);
    perform public.demanda_close_if_all_done(p_demanda);
  else
    update public.action_demanda_assignees set done_requested_at = null
    where demanda_id = p_demanda and user_id = p_user;
    insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body, meta)
    values (v_tenant, p_demanda, 'conclusao_rejected', v_uid, nullif(trim(p_note),''), jsonb_build_object('user', p_user));
    perform public.notify_users(v_tenant, array[p_user], 'decision', 'Conclusão reprovada', v_desc, p_demanda);
  end if;
end; $$;

-- 6) Reabertura por pessoa
create or replace function public.demanda_assignee_reopen(p_demanda uuid, p_user uuid, p_note text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid; v_requester uuid; v_desc text; v_uid uuid := auth.uid();
begin
  select d.tenant_id, a.requester_id, d.description into v_tenant, v_requester, v_desc
  from public.action_demandas d join public.actions a on a.id = d.action_id where d.id = p_demanda;
  if v_tenant is null then raise exception 'Ação não encontrada'; end if;
  if not (v_uid = v_requester or public.has_tenant_role(v_tenant, array['owner','admin']::public.member_role[])) then
    raise exception 'Apenas o solicitante ou um administrador pode reabrir';
  end if;
  update public.action_demanda_assignees set completed_at = null, done_requested_at = null
  where demanda_id = p_demanda and user_id = p_user;
  update public.action_demandas set status = 'in_progress', completed_at = null
  where id = p_demanda and status = 'done';
  insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body, meta)
  values (v_tenant, p_demanda, 'reopened', v_uid, nullif(trim(p_note),''), jsonb_build_object('user', p_user));
  perform public.notify_users(v_tenant, array[p_user], 'reopened', 'Sua parte foi reaberta', v_desc, p_demanda);
end; $$;

-- 7) Reatribuir preservando o estado de quem permanece
create or replace function public.demanda_reassign(p_demanda uuid, p_users jsonb, p_note text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid; v_requester uuid; v_uid uuid := auth.uid(); v_desc text; v_status public.action_status;
  v_old uuid[]; v_new uuid[]; v_added uuid[]; v_removed uuid[];
begin
  select d.tenant_id, a.requester_id, d.description, d.status into v_tenant, v_requester, v_desc, v_status
  from public.action_demandas d join public.actions a on a.id = d.action_id where d.id = p_demanda;
  if v_tenant is null then raise exception 'Ação não encontrada'; end if;
  if not (v_uid = v_requester or public.has_tenant_role(v_tenant, array['owner','admin']::public.member_role[])) then
    raise exception 'Apenas o solicitante ou um administrador pode reatribuir';
  end if;
  v_old := array(select user_id from public.action_demanda_assignees where demanda_id = p_demanda);
  v_new := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p_users,'[]'::jsonb)) x);
  v_removed := array(select x from unnest(v_old) x where x <> all(v_new));
  v_added := array(select x from unnest(v_new) x where x <> all(v_old));
  delete from public.action_demanda_assignees where demanda_id = p_demanda and user_id = any(v_removed);
  insert into public.action_demanda_assignees (demanda_id, user_id)
    select p_demanda, u from unnest(v_added) u on conflict do nothing;
  if array_length(v_added, 1) is not null and v_status = 'done' then
    update public.action_demandas set status = 'in_progress', completed_at = null where id = p_demanda;
  end if;
  insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body, meta)
  values (v_tenant, p_demanda, 'reassigned', v_uid, nullif(trim(p_note),''), jsonb_build_object('users', to_jsonb(v_new)));
  perform public.notify_users(v_tenant, array(select x from unnest(v_added) x where x <> v_uid), 'reassigned', 'Você foi designado responsável', v_desc, p_demanda);
end; $$;

-- 8) Reabertura da demanda inteira também limpa o estado por pessoa
create or replace function public.demanda_reopen(p_demanda uuid, p_note text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid; v_requester uuid; v_uid uuid := auth.uid(); v_status public.action_status; v_desc text; v_assignees uuid[];
begin
  select d.tenant_id, a.requester_id, d.status, d.description into v_tenant, v_requester, v_status, v_desc
  from public.action_demandas d join public.actions a on a.id = d.action_id where d.id = p_demanda;
  if v_tenant is null then raise exception 'Ação não encontrada'; end if;
  if not (v_uid = v_requester or public.has_tenant_role(v_tenant, array['owner','admin']::public.member_role[])) then
    raise exception 'Apenas o solicitante ou um administrador pode reabrir';
  end if;
  if v_status <> 'done' then raise exception 'Só é possível reabrir ações concluídas'; end if;
  update public.action_demandas set status = 'in_progress', completed_at = null where id = p_demanda;
  update public.action_demanda_assignees set completed_at = null, done_requested_at = null where demanda_id = p_demanda;
  insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body)
  values (v_tenant, p_demanda, 'reopened', v_uid, nullif(trim(p_note),''));
  v_assignees := array(select user_id from public.action_demanda_assignees where demanda_id = p_demanda);
  perform public.notify_users(v_tenant, array(select x from unnest(v_assignees) x where x <> v_uid), 'reopened', 'Ação reaberta', v_desc, p_demanda);
end; $$;
