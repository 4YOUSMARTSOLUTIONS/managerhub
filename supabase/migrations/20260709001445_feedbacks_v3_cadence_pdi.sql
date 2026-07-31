-- 1) cadência por setor + função
create table public.feedback_cadence_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  position_id uuid not null references public.positions(id) on delete cascade,
  cadence_days integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (tenant_id, department_id, position_id)
);
alter table public.feedback_cadence_rules enable row level security;
create policy fcr_select on public.feedback_cadence_rules
  for select using (public.is_tenant_member(tenant_id));
create policy fcr_write on public.feedback_cadence_rules
  for all using (public.is_tenant_member(tenant_id) and public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]))
  with check (public.is_tenant_member(tenant_id) and public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]));

-- 2) PDI
create type public.pdi_action_status as enum ('pendente','em_andamento','conclusao_solicitada','concluida','cancelada');

create table public.pdi_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subject_user_id uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  source_feedback_id uuid references public.feedbacks(id) on delete set null,
  title text not null,
  description text,
  status public.pdi_action_status not null default 'pendente',
  due_date date,
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pdi_actions_subject_idx on public.pdi_actions (tenant_id, subject_user_id, created_at desc);

create table public.pdi_action_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  action_id uuid not null references public.pdi_actions(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.pdi_actions enable row level security;
alter table public.pdi_action_comments enable row level security;

create policy pdi_select on public.pdi_actions
  for select using (
    public.is_tenant_member(tenant_id) and (
      public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
      or public.manages_user(subject_user_id, tenant_id)
      or subject_user_id = auth.uid()
      or created_by = auth.uid()
    )
  );
create policy pdi_insert on public.pdi_actions
  for insert with check (
    public.is_tenant_member(tenant_id)
    and created_by = auth.uid()
    and subject_user_id <> auth.uid()
    and (public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]) or public.manages_user(subject_user_id, tenant_id))
  );
create policy pdi_update on public.pdi_actions
  for update using (
    public.is_tenant_member(tenant_id) and (
      public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
      or public.manages_user(subject_user_id, tenant_id)
      or subject_user_id = auth.uid()
    )
  ) with check (
    public.is_tenant_member(tenant_id) and (
      public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
      or public.manages_user(subject_user_id, tenant_id)
      or subject_user_id = auth.uid()
    )
  );
create policy pdi_delete on public.pdi_actions
  for delete using (
    public.is_tenant_member(tenant_id) and (
      public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
      or public.manages_user(subject_user_id, tenant_id)
    )
  );

create policy pdic_select on public.pdi_action_comments
  for select using (exists (select 1 from public.pdi_actions a where a.id = action_id));
create policy pdic_insert on public.pdi_action_comments
  for insert with check (
    author_id = auth.uid() and exists (select 1 from public.pdi_actions a where a.id = action_id)
  );
create policy pdic_delete on public.pdi_action_comments
  for delete using (
    author_id = auth.uid() or exists (
      select 1 from public.pdi_actions a where a.id = action_id
        and public.has_tenant_role(a.tenant_id, '{owner,admin}'::public.member_role[])
    )
  );

-- 3) trigger: só gestor/admin conclui ou cancela
create or replace function public.guard_pdi_status()
returns trigger language plpgsql
security definer set search_path to 'public' as $$
declare v_priv boolean;
begin
  if NEW.status is distinct from OLD.status and NEW.status in ('concluida','cancelada') then
    v_priv := public.has_tenant_role(NEW.tenant_id, '{owner,admin}'::public.member_role[])
              or public.manages_user(NEW.subject_user_id, NEW.tenant_id);
    if not v_priv then
      raise exception 'Apenas o gestor do colaborador ou um administrador pode concluir/cancelar a ação do PDI.';
    end if;
  end if;
  return NEW;
end $$;
create trigger trg_guard_pdi_status
  before update on public.pdi_actions
  for each row execute function public.guard_pdi_status();
