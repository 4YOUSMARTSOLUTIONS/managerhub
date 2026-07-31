alter table public.area_goals
  add column if not exists parent_id uuid references public.area_goals(id) on delete set null;
create index if not exists area_goals_parent_id_idx on public.area_goals(parent_id);
