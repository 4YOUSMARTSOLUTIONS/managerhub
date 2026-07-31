alter table public.area_goals
  add column if not exists unit_id uuid references public.units(id) on delete set null;
