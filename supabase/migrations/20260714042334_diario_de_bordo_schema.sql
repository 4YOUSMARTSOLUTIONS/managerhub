-- ===== Enums =====
create type public.agenda_frequency as enum ('diaria','semanal','mensal','unica');
create type public.agenda_log_status as enum ('pendente','feito','parcial','nao_feito');

-- ===== Tabelas =====
create table public.agendas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  name text not null,
  description text,
  owner_id uuid not null,
  responsible_id uuid not null,
  can_responsible_edit boolean not null default false,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agenda_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agenda_id uuid not null references public.agendas(id) on delete cascade,
  title text not null,
  description text,
  scheduled_time time,
  duration_minutes integer not null default 30,
  frequency public.agenda_frequency not null default 'diaria',
  weekdays integer[] not null default '{}',
  day_of_month integer,
  fixed_date date,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.agenda_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agenda_id uuid not null references public.agendas(id) on delete cascade,
  task_id uuid not null references public.agenda_tasks(id) on delete cascade,
  log_date date not null,
  status public.agenda_log_status not null default 'pendente',
  note text,
  actual_minutes integer,
  done_by uuid,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, log_date)
);

create table public.agenda_log_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  log_id uuid not null references public.agenda_logs(id) on delete cascade,
  author_id uuid not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.agenda_log_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  log_id uuid not null references public.agenda_logs(id) on delete cascade,
  path text not null,
  filename text not null,
  size bigint,
  content_type text,
  uploaded_by uuid not null,
  created_at timestamptz not null default now()
);

create index agenda_tasks_agenda_idx on public.agenda_tasks(agenda_id);
create index agenda_logs_tenant_date_idx on public.agenda_logs(tenant_id, log_date);
create index agenda_logs_task_idx on public.agenda_logs(task_id);
create index agendas_tenant_resp_idx on public.agendas(tenant_id, responsible_id);
create index agenda_log_comments_log_idx on public.agenda_log_comments(log_id);
create index agenda_log_attachments_log_idx on public.agenda_log_attachments(log_id);

-- ===== Helpers de permissão (SECURITY DEFINER) =====
create or replace function public.agenda_can_view(p_tenant uuid, p_owner uuid, p_responsible uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_tenant_member(p_tenant) and (
    public.has_tenant_role(p_tenant, '{owner,admin}'::public.member_role[])
    or p_owner = auth.uid()
    or p_responsible = auth.uid()
    or public.manages_user(p_owner, p_tenant)
    or public.manages_user(p_responsible, p_tenant)
  );
$$;

create or replace function public.agenda_can_admin(p_tenant uuid, p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_tenant_member(p_tenant) and (
    public.has_tenant_role(p_tenant, '{owner,admin}'::public.member_role[])
    or p_owner = auth.uid()
    or public.manages_user(p_owner, p_tenant)
  );
$$;

create or replace function public.agenda_can_fill(p_tenant uuid, p_owner uuid, p_responsible uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_tenant_member(p_tenant) and (
    public.has_tenant_role(p_tenant, '{owner,admin}'::public.member_role[])
    or p_owner = auth.uid()
    or p_responsible = auth.uid()
    or public.manages_user(p_owner, p_tenant)
    or public.manages_user(p_responsible, p_tenant)
  );
$$;

-- ===== RLS =====
alter table public.agendas enable row level security;
alter table public.agenda_tasks enable row level security;
alter table public.agenda_logs enable row level security;
alter table public.agenda_log_comments enable row level security;
alter table public.agenda_log_attachments enable row level security;

-- agendas
create policy ag_select on public.agendas for select
  using (public.agenda_can_view(tenant_id, owner_id, responsible_id));
create policy ag_insert on public.agendas for insert
  with check (public.is_tenant_member(tenant_id) and owner_id = auth.uid());
create policy ag_update on public.agendas for update
  using (public.agenda_can_admin(tenant_id, owner_id))
  with check (public.agenda_can_admin(tenant_id, owner_id));
create policy ag_delete on public.agendas for delete
  using (public.agenda_can_admin(tenant_id, owner_id));

-- agenda_tasks (via agenda pai)
create policy ag_task_select on public.agenda_tasks for select
  using (exists (select 1 from public.agendas a where a.id = agenda_tasks.agenda_id
    and public.agenda_can_view(a.tenant_id, a.owner_id, a.responsible_id)));
create policy ag_task_write on public.agenda_tasks for all
  using (exists (select 1 from public.agendas a where a.id = agenda_tasks.agenda_id
    and (public.agenda_can_admin(a.tenant_id, a.owner_id)
      or (a.responsible_id = auth.uid() and a.can_responsible_edit))))
  with check (exists (select 1 from public.agendas a where a.id = agenda_tasks.agenda_id
    and (public.agenda_can_admin(a.tenant_id, a.owner_id)
      or (a.responsible_id = auth.uid() and a.can_responsible_edit))));

-- agenda_logs (via agenda pai)
create policy ag_log_select on public.agenda_logs for select
  using (exists (select 1 from public.agendas a where a.id = agenda_logs.agenda_id
    and public.agenda_can_view(a.tenant_id, a.owner_id, a.responsible_id)));
create policy ag_log_write on public.agenda_logs for all
  using (exists (select 1 from public.agendas a where a.id = agenda_logs.agenda_id
    and public.agenda_can_fill(a.tenant_id, a.owner_id, a.responsible_id)))
  with check (exists (select 1 from public.agendas a where a.id = agenda_logs.agenda_id
    and public.agenda_can_fill(a.tenant_id, a.owner_id, a.responsible_id)));

-- comments (via log -> agenda)
create policy ag_cmt_select on public.agenda_log_comments for select
  using (exists (select 1 from public.agenda_logs l join public.agendas a on a.id = l.agenda_id
    where l.id = agenda_log_comments.log_id
    and public.agenda_can_view(a.tenant_id, a.owner_id, a.responsible_id)));
create policy ag_cmt_insert on public.agenda_log_comments for insert
  with check (author_id = auth.uid() and exists (select 1 from public.agenda_logs l join public.agendas a on a.id = l.agenda_id
    where l.id = agenda_log_comments.log_id
    and public.agenda_can_view(a.tenant_id, a.owner_id, a.responsible_id)));
create policy ag_cmt_delete on public.agenda_log_comments for delete
  using (author_id = auth.uid() or public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]));

-- attachments (via log -> agenda)
create policy ag_att_select on public.agenda_log_attachments for select
  using (exists (select 1 from public.agenda_logs l join public.agendas a on a.id = l.agenda_id
    where l.id = agenda_log_attachments.log_id
    and public.agenda_can_view(a.tenant_id, a.owner_id, a.responsible_id)));
create policy ag_att_insert on public.agenda_log_attachments for insert
  with check (uploaded_by = auth.uid() and exists (select 1 from public.agenda_logs l join public.agendas a on a.id = l.agenda_id
    where l.id = agenda_log_attachments.log_id
    and public.agenda_can_fill(a.tenant_id, a.owner_id, a.responsible_id)));
create policy ag_att_delete on public.agenda_log_attachments for delete
  using (uploaded_by = auth.uid() or public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]));

-- ===== Bucket privado + storage policies (foldername[1] = tenant) =====
insert into storage.buckets (id, name, public) values ('agenda-attachments','agenda-attachments', false)
on conflict (id) do nothing;

create policy agenda_att_read on storage.objects for select
  using (bucket_id = 'agenda-attachments' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));
create policy agenda_att_insert on storage.objects for insert
  with check (bucket_id = 'agenda-attachments' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));
create policy agenda_att_delete on storage.objects for delete
  using (bucket_id = 'agenda-attachments' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));
