alter table public.individual_goals
  add column if not exists weight numeric not null default 0;

notify pgrst, 'reload schema';
