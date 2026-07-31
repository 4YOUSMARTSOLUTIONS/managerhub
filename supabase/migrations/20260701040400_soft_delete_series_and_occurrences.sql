alter table public.meeting_series add column if not exists deleted_at timestamptz;
alter table public.meeting_occurrences add column if not exists deleted_at timestamptz;
create index if not exists idx_meeting_series_not_deleted on public.meeting_series (tenant_id) where deleted_at is null;
create index if not exists idx_meeting_occurrences_not_deleted on public.meeting_occurrences (tenant_id) where deleted_at is null;
