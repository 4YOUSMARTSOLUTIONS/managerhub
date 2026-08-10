-- Planner v2: notificações de atribuição e de prazo.
--
-- `notifications` ganha um destino de navegação novo (`planner_board_id`) e
-- `notify_users` ganha um sétimo argumento com DEFAULT: as dezenas de chamadas
-- posicionais de 6 args nas RPCs de demanda continuam válidas sem tocar em
-- nenhuma. A função antiga sai antes porque mudar assinatura por cima criaria
-- uma sobrecarga, e aí o Postgres não saberia qual das duas resolver.
--
-- O cron de prazos roda 1x por dia e o dedupe é a coluna `due_notified_at`:
-- notifica quem tem tarefa pendente com prazo de hoje ou vencido E ainda sem
-- carimbo, e carimba na mesma função. Rodar duas vezes no mesmo dia não duplica
-- nada; mudar o prazo zera o carimbo (updateTask) e re-arma. Sem isso, uma
-- tarefa vencida encheria o sino TODO dia até alguém concluí-la.

alter table public.notifications
  add column planner_board_id uuid references public.planner_boards(id) on delete cascade;

drop function public.notify_users(uuid, uuid[], text, text, text, uuid);
create function public.notify_users(
  p_tenant uuid, p_users uuid[], p_type text, p_title text, p_body text,
  p_demanda uuid, p_planner_board uuid default null
)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.notifications (tenant_id, user_id, type, title, body, demanda_id, planner_board_id)
  select distinct p_tenant, u, p_type, p_title, p_body, p_demanda, p_planner_board
  from unnest(p_users) u
  where u is not null
    and public.is_tenant_member(p_tenant);
$$;

-- os MESMOS revokes da versão anterior: esquecê-los abriria a função a anon
revoke execute on function public.notify_users(uuid, uuid[], text, text, text, uuid, uuid) from public, anon;

-- ------------------------------------------------------------- cron de prazos
create or replace function public.planner_notify_due_tasks()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select t.id, t.tenant_id, t.board_id, t.title, t.due_date, b.name as board_name,
           array_agg(a.user_id) as assignees
    from public.planner_tasks t
    join public.planner_boards b on b.id = t.board_id
    join public.planner_task_assignees a on a.task_id = t.id
    where t.progress <> 'done'
      and t.due_date is not null
      and t.due_date <= current_date
      and t.due_notified_at is null
    group by t.id, t.tenant_id, t.board_id, t.title, t.due_date, b.name
  loop
    perform public.notify_users(
      r.tenant_id,
      r.assignees,
      'planner_due',
      case when r.due_date < current_date then 'Tarefa com prazo vencido' else 'Tarefa vence hoje' end,
      r.board_name || ': ' || r.title,
      null,
      r.board_id
    );
    update public.planner_tasks set due_notified_at = current_date where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- só o cron chama; nem o app precisa dela
revoke execute on function public.planner_notify_due_tasks() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('planner-prazos', '0 11 * * *', 'select public.planner_notify_due_tasks();');
