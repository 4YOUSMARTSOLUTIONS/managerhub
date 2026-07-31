-- 1) estado "aplicado" nos feedbacks pontuais
alter table public.feedbacks add column if not exists applied_at timestamptz;

-- colaborador só vê quando compartilhado E aplicado
drop policy if exists fb_select on public.feedbacks;
create policy fb_select on public.feedbacks
  for select using (
    public.is_tenant_member(tenant_id) and (
      public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
      or public.manages_user(subject_user_id, tenant_id)
      or author_id = auth.uid()
      or (subject_user_id = auth.uid() and visibility = 'compartilhado' and applied_at is not null)
    )
  );

-- 2) sessões de feedback (1:1 periódico)
create table public.feedback_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subject_user_id uuid not null references public.profiles(id),
  author_id uuid not null references public.profiles(id),
  session_date date not null,
  reference_month date,
  title text,
  highlights text,
  development text,
  action_plan text,
  overall text,
  visibility public.feedback_visibility not null default 'compartilhado',
  applied_at timestamptz,
  acknowledged_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index feedback_sessions_subject_idx on public.feedback_sessions (tenant_id, subject_user_id, session_date desc);

create table public.feedback_session_items (
  session_id uuid not null references public.feedback_sessions(id) on delete cascade,
  feedback_id uuid not null references public.feedbacks(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  primary key (session_id, feedback_id)
);

-- 3) periodicidade esperada (por tenant)
create table public.feedback_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  cadence_days integer not null default 30,
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.feedback_sessions enable row level security;
alter table public.feedback_session_items enable row level security;
alter table public.feedback_settings enable row level security;

create policy fbs_select on public.feedback_sessions
  for select using (
    public.is_tenant_member(tenant_id) and (
      public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
      or public.manages_user(subject_user_id, tenant_id)
      or author_id = auth.uid()
      or (subject_user_id = auth.uid() and visibility = 'compartilhado' and applied_at is not null)
    )
  );
create policy fbs_insert on public.feedback_sessions
  for insert with check (
    public.is_tenant_member(tenant_id)
    and author_id = auth.uid()
    and subject_user_id <> auth.uid()
    and (public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]) or public.manages_user(subject_user_id, tenant_id))
  );
create policy fbs_update on public.feedback_sessions
  for update using (
    public.is_tenant_member(tenant_id) and (public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]) or author_id = auth.uid())
  ) with check (
    public.is_tenant_member(tenant_id) and (public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]) or author_id = auth.uid())
  );
create policy fbs_delete on public.feedback_sessions
  for delete using (
    public.is_tenant_member(tenant_id) and (public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]) or author_id = auth.uid())
  );

create policy fbsi_select on public.feedback_session_items
  for select using (exists (select 1 from public.feedback_sessions s where s.id = session_id));
create policy fbsi_write on public.feedback_session_items
  for all using (
    exists (select 1 from public.feedback_sessions s where s.id = session_id
      and (public.has_tenant_role(s.tenant_id, '{owner,admin}'::public.member_role[]) or s.author_id = auth.uid()))
  ) with check (
    exists (select 1 from public.feedback_sessions s where s.id = session_id
      and (public.has_tenant_role(s.tenant_id, '{owner,admin}'::public.member_role[]) or s.author_id = auth.uid()))
  );

create policy fbset_select on public.feedback_settings
  for select using (public.is_tenant_member(tenant_id));
create policy fbset_write on public.feedback_settings
  for all using (public.is_tenant_member(tenant_id) and public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]))
  with check (public.is_tenant_member(tenant_id) and public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]));
