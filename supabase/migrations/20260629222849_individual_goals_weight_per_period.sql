alter table public.individual_goal_entries
  add column if not exists weight numeric not null default 0;

-- backfill: leva o peso global da meta para os registros existentes
update public.individual_goal_entries e
  set weight = g.weight
  from public.individual_goals g
  where g.id = e.goal_id and e.weight = 0;

-- peso agora é por competência (no registro), não na definição da meta
alter table public.individual_goals drop column if exists weight;

notify pgrst, 'reload schema';
