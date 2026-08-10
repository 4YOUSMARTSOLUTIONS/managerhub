-- O cron notificava ZERO, e o teste de mesa pegou antes da produção.
--
-- `notify_users` filtra por `is_tenant_member(p_tenant)`, que lê o `auth.uid()`
-- de quem CHAMA — a guarda certa para RPC invocada por usuário. O cron roda
-- como postgres, sem usuário nenhum: o filtro descartava todos os destinatários
-- em silêncio.
--
-- A função do cron passa a inserir direto em `notifications`. É seguro porque
-- os destinatários não vêm de entrada nenhuma: saem de um JOIN com
-- `planner_task_assignees`, dados que o próprio banco mantém.
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
    insert into public.notifications (tenant_id, user_id, type, title, body, planner_board_id)
    select distinct r.tenant_id, u,
      'planner_due',
      case when r.due_date < current_date then 'Tarefa com prazo vencido' else 'Tarefa vence hoje' end,
      r.board_name || ': ' || r.title,
      r.board_id
    from unnest(r.assignees) u
    where u is not null;

    update public.planner_tasks set due_notified_at = current_date where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.planner_notify_due_tasks() from public, anon, authenticated;
