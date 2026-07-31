create type checklist_task_status as enum ('pendente','em_andamento','concluida','cancelada');

alter table checklists add column default_assignee_id uuid references profiles(id) on delete set null;

create table checklist_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  checklist_id uuid not null references checklists(id) on delete cascade,
  run_id uuid not null references checklist_runs(id) on delete cascade,
  item_id uuid not null references checklist_items(id) on delete cascade,
  unit_id uuid references units(id) on delete set null,
  title text not null,
  description text,
  assignee_id uuid references profiles(id) on delete set null,
  status checklist_task_status not null default 'pendente',
  resolution text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (run_id, item_id)
);
create index checklist_tasks_tenant_idx on checklist_tasks (tenant_id);
create index checklist_tasks_assignee_idx on checklist_tasks (assignee_id);
create index checklist_tasks_checklist_idx on checklist_tasks (checklist_id);

create table checklist_task_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  task_id uuid not null references checklist_tasks(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);
create index checklist_task_comments_task_idx on checklist_task_comments (task_id);

alter table checklist_tasks enable row level security;
alter table checklist_task_comments enable row level security;

create policy cl_tasks_select on checklist_tasks for select using (
  is_tenant_member(tenant_id) and (
    has_tenant_role(tenant_id,'{owner,admin}'::member_role[])
    or assignee_id = auth.uid()
    or created_by = auth.uid()
    or manages_user(assignee_id, tenant_id)
    or exists (select 1 from checklists c where c.id = checklist_tasks.checklist_id and c.created_by = auth.uid())
  )
);
create policy cl_tasks_insert on checklist_tasks for insert with check (
  is_tenant_member(tenant_id) and created_by = auth.uid()
);
create policy cl_tasks_update on checklist_tasks for update using (
  is_tenant_member(tenant_id) and (
    has_tenant_role(tenant_id,'{owner,admin}'::member_role[])
    or assignee_id = auth.uid()
    or manages_user(assignee_id, tenant_id)
    or exists (select 1 from checklists c where c.id = checklist_tasks.checklist_id and c.created_by = auth.uid())
  )
) with check ( is_tenant_member(tenant_id) );
create policy cl_tasks_delete on checklist_tasks for delete using (
  is_tenant_member(tenant_id) and (has_tenant_role(tenant_id,'{owner,admin}'::member_role[]) or created_by = auth.uid())
);

create policy cl_task_comments_select on checklist_task_comments for select using (
  is_tenant_member(tenant_id) and exists (select 1 from checklist_tasks t where t.id = checklist_task_comments.task_id)
);
create policy cl_task_comments_insert on checklist_task_comments for insert with check (
  is_tenant_member(tenant_id) and author_id = auth.uid() and exists (select 1 from checklist_tasks t where t.id = checklist_task_comments.task_id)
);
create policy cl_task_comments_delete on checklist_task_comments for delete using (
  is_tenant_member(tenant_id) and (author_id = auth.uid() or has_tenant_role(tenant_id,'{owner,admin}'::member_role[]))
);
