-- Planner v2: as colunas novas do cartão.
--
-- `progress` passa a ser a fonte de verdade do estado; `completed_at` vira o
-- carimbo de QUANDO concluiu (exportação e histórico). O backfill converte o
-- que já existia: quem tinha carimbo estava concluído.
--
-- `due_notified_at` é o dedupe do cron de prazos: a notificação sai uma vez por
-- prazo, e mudar o prazo zera o carimbo (re-arma). Sem a coluna, o cron diário
-- notificaria a mesma tarefa vencida todo dia, e o sino viraria ruído.

alter table public.planner_tasks
  add column start_date date,
  add column progress public.planner_progress not null default 'not_started',
  add column recurrence public.planner_recurrence not null default 'none',
  add column due_notified_at date;

update public.planner_tasks set progress = 'done' where completed_at is not null;

-- o cron varre só o que pode notificar: pendente e com prazo
create index planner_tasks_due_pend_idx on public.planner_tasks (due_date)
  where progress <> 'done' and due_date is not null;
