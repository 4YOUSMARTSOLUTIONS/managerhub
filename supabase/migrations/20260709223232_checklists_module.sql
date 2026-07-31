-- ===== enums =====
create type public.checklist_visibility as enum ('todos','usuarios','cargos','areas');
create type public.checklist_item_type as enum ('conformidade','sim_nao','texto','numero','selecao','nota');
create type public.checklist_frequency as enum ('unica','diaria','semanal','mensal','anual');
create type public.checklist_run_status as enum ('em_andamento','concluida');

-- ===== config: categorias =====
create table public.checklist_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

-- ===== modelo =====
create table public.checklists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  name text not null,
  description text,
  department_id uuid references public.departments(id) on delete set null,
  subdepartment_id uuid references public.subdepartments(id) on delete set null,
  category_id uuid references public.checklist_categories(id) on delete set null,
  visibility public.checklist_visibility not null default 'todos',
  created_by uuid not null references public.profiles(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.checklist_audiences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  kind text not null check (kind in ('user','position','department')),
  ref_id uuid not null
);
create index checklist_audiences_cl_idx on public.checklist_audiences (checklist_id);

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  section text,
  sort integer not null default 0,
  label text not null,
  help text,
  type public.checklist_item_type not null default 'conformidade',
  required boolean not null default true,
  allow_photo boolean not null default false,
  options jsonb,
  created_at timestamptz not null default now()
);
create index checklist_items_cl_idx on public.checklist_items (checklist_id, sort);

-- ===== agendamento =====
create table public.checklist_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  frequency public.checklist_frequency not null,
  fixed_date date,
  weekday integer,
  day_of_month integer,
  run_time time,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create table public.checklist_schedule_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  schedule_id uuid not null references public.checklist_schedules(id) on delete cascade,
  kind text not null check (kind in ('user','position','department')),
  ref_id uuid not null
);
create index checklist_sched_targets_idx on public.checklist_schedule_targets (schedule_id);

-- ===== execução =====
create table public.checklist_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  schedule_id uuid references public.checklist_schedules(id) on delete set null,
  unit_id uuid references public.units(id) on delete set null,
  executor_id uuid not null references public.profiles(id),
  period_key text,
  status public.checklist_run_status not null default 'em_andamento',
  score numeric,
  conform_count integer not null default 0,
  nonconform_count integer not null default 0,
  na_count integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index checklist_runs_dedup_idx on public.checklist_runs (checklist_id, executor_id, period_key);
create index checklist_runs_hist_idx on public.checklist_runs (tenant_id, completed_at desc);

create table public.checklist_run_answers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.checklist_runs(id) on delete cascade,
  item_id uuid not null references public.checklist_items(id) on delete cascade,
  value_conformidade text,
  value_bool boolean,
  value_text text,
  value_number numeric,
  value_option text,
  note text,
  created_at timestamptz not null default now()
);
create index checklist_run_answers_run_idx on public.checklist_run_answers (run_id);

create table public.checklist_answer_photos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.checklist_runs(id) on delete cascade,
  item_id uuid not null references public.checklist_items(id) on delete cascade,
  path text not null,
  filename text not null,
  size bigint,
  content_type text,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);
create index checklist_answer_photos_run_idx on public.checklist_answer_photos (run_id);
