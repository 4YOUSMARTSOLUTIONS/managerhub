
alter table public.meetings
  add column if not exists series_id uuid references public.meeting_series(id) on delete set null;
create index if not exists meetings_series_idx on public.meetings(series_id);
notify pgrst, 'reload schema';

