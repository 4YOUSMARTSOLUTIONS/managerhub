
-- =============================================================
-- MANAGERHUB · Migração 26 · Registro de execução de reuniões
-- =============================================================

-- Periodicidade das reuniões recorrentes
do $$ begin
  create type public.meeting_periodicity as enum
    ('diaria','semanal','quinzenal','mensal','bimestral','trimestral','semestral','anual','sob_demanda');
exception when duplicate_object then null; end $$;

-- Catálogo de reuniões que devem acontecer (recorrentes)
create table if not exists public.meeting_series (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  periodicity public.meeting_periodicity not null default 'mensal',
  next_date date,
  standard text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists meeting_series_tenant_idx on public.meeting_series(tenant_id);

-- Participantes habituais de cada reunião
create table if not exists public.meeting_series_participants (
  series_id uuid not null references public.meeting_series(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (series_id, user_id)
);

-- Registro de cada acontecimento (execução)
create table if not exists public.meeting_occurrences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  series_id uuid not null references public.meeting_series(id) on delete cascade,
  occurred_on date not null default current_date,
  notes text,
  decisions text,
  registered_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists meeting_occurrences_tenant_idx on public.meeting_occurrences(tenant_id);
create index if not exists meeting_occurrences_series_idx on public.meeting_occurrences(series_id);

-- Presença por acontecimento
create table if not exists public.meeting_attendance (
  occurrence_id uuid not null references public.meeting_occurrences(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  present boolean not null default true,
  primary key (occurrence_id, user_id)
);

-- Liga ações geradas numa reunião ao seu registro
alter table public.action_items
  add column if not exists occurrence_id uuid references public.meeting_occurrences(id) on delete set null;

-- ---------- RLS ----------
alter table public.meeting_series enable row level security;
alter table public.meeting_series_participants enable row level security;
alter table public.meeting_occurrences enable row level security;
alter table public.meeting_attendance enable row level security;

drop policy if exists meeting_series_rw on public.meeting_series;
create policy meeting_series_rw on public.meeting_series
  for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

drop policy if exists msp_rw on public.meeting_series_participants;
create policy msp_rw on public.meeting_series_participants
  for all using (exists (select 1 from public.meeting_series s where s.id = series_id and public.is_tenant_member(s.tenant_id)))
  with check (exists (select 1 from public.meeting_series s where s.id = series_id and public.is_tenant_member(s.tenant_id)));

drop policy if exists meeting_occurrences_rw on public.meeting_occurrences;
create policy meeting_occurrences_rw on public.meeting_occurrences
  for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

drop policy if exists attendance_rw on public.meeting_attendance;
create policy attendance_rw on public.meeting_attendance
  for all using (exists (select 1 from public.meeting_occurrences o where o.id = occurrence_id and public.is_tenant_member(o.tenant_id)))
  with check (exists (select 1 from public.meeting_occurrences o where o.id = occurrence_id and public.is_tenant_member(o.tenant_id)));

grant select, insert, update, delete on public.meeting_series, public.meeting_series_participants, public.meeting_occurrences, public.meeting_attendance to authenticated;

notify pgrst, 'reload schema';

