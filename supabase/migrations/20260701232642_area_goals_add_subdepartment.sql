alter table public.area_goals
  add column if not exists subdepartment_id uuid references public.subdepartments(id) on delete set null;
