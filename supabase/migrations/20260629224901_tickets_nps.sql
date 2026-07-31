alter table public.tickets
  add column if not exists nps_score smallint check (nps_score between 0 and 10),
  add column if not exists nps_comment text,
  add column if not exists rated_at timestamptz;

notify pgrst, 'reload schema';
