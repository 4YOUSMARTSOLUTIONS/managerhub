alter table public.meetings
  add column if not exists ics_sequence integer not null default 0;

notify pgrst, 'reload schema';
