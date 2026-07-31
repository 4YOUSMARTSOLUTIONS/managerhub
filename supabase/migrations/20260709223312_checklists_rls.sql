alter table public.checklist_categories enable row level security;
alter table public.checklists enable row level security;
alter table public.checklist_audiences enable row level security;
alter table public.checklist_items enable row level security;
alter table public.checklist_schedules enable row level security;
alter table public.checklist_schedule_targets enable row level security;
alter table public.checklist_runs enable row level security;
alter table public.checklist_run_answers enable row level security;
alter table public.checklist_answer_photos enable row level security;

-- categorias
create policy cl_cat_select on public.checklist_categories for select using (public.is_tenant_member(tenant_id));
create policy cl_cat_write on public.checklist_categories for all
  using (public.is_tenant_member(tenant_id) and public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]))
  with check (public.is_tenant_member(tenant_id) and public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]));

-- helper de "posso ver este checklist"
create or replace function public.can_view_checklist(p_checklist public.checklists)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.is_tenant_member(p_checklist.tenant_id) and (
    public.has_tenant_role(p_checklist.tenant_id, '{owner,admin}'::public.member_role[])
    or p_checklist.created_by = auth.uid()
    or public.manages_user(p_checklist.created_by, p_checklist.tenant_id)
    or p_checklist.visibility = 'todos'
    or exists (
      select 1 from public.checklist_audiences a
      where a.checklist_id = p_checklist.id and (
        (a.kind = 'user' and a.ref_id = auth.uid())
        or (a.kind = 'position' and a.ref_id in (select m.position_id from public.memberships m where m.tenant_id = p_checklist.tenant_id and m.user_id = auth.uid() and m.position_id is not null))
        or (a.kind = 'department' and a.ref_id in (select m.department_id from public.memberships m where m.tenant_id = p_checklist.tenant_id and m.user_id = auth.uid() and m.department_id is not null))
      )
    )
  );
$$;

create or replace function public.can_edit_checklist(p_tenant uuid, p_created_by uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.is_tenant_member(p_tenant) and (
    public.has_tenant_role(p_tenant, '{owner,admin}'::public.member_role[])
    or p_created_by = auth.uid()
    or public.manages_user(p_created_by, p_tenant)
  );
$$;

-- checklists
create policy cl_select on public.checklists for select using (public.can_view_checklist(checklists));
create policy cl_insert on public.checklists for insert with check (public.is_tenant_member(tenant_id) and created_by = auth.uid());
create policy cl_update on public.checklists for update using (public.can_edit_checklist(tenant_id, created_by)) with check (public.can_edit_checklist(tenant_id, created_by));
create policy cl_delete on public.checklists for delete using (public.can_edit_checklist(tenant_id, created_by));

-- filhos do checklist (audiences/items/schedules/targets): ver se vê o pai; escrever se edita o pai
create policy cl_aud_select on public.checklist_audiences for select using (exists (select 1 from public.checklists c where c.id = checklist_id and public.can_view_checklist(c)));
create policy cl_aud_write on public.checklist_audiences for all
  using (exists (select 1 from public.checklists c where c.id = checklist_id and public.can_edit_checklist(c.tenant_id, c.created_by)))
  with check (exists (select 1 from public.checklists c where c.id = checklist_id and public.can_edit_checklist(c.tenant_id, c.created_by)));

create policy cl_items_select on public.checklist_items for select using (exists (select 1 from public.checklists c where c.id = checklist_id and public.can_view_checklist(c)));
create policy cl_items_write on public.checklist_items for all
  using (exists (select 1 from public.checklists c where c.id = checklist_id and public.can_edit_checklist(c.tenant_id, c.created_by)))
  with check (exists (select 1 from public.checklists c where c.id = checklist_id and public.can_edit_checklist(c.tenant_id, c.created_by)));

create policy cl_sched_select on public.checklist_schedules for select using (exists (select 1 from public.checklists c where c.id = checklist_id and public.can_view_checklist(c)));
create policy cl_sched_write on public.checklist_schedules for all
  using (exists (select 1 from public.checklists c where c.id = checklist_id and public.can_edit_checklist(c.tenant_id, c.created_by)))
  with check (exists (select 1 from public.checklists c where c.id = checklist_id and public.can_edit_checklist(c.tenant_id, c.created_by)));

create policy cl_sched_tg_select on public.checklist_schedule_targets for select using (exists (select 1 from public.checklist_schedules s join public.checklists c on c.id = s.checklist_id where s.id = schedule_id and public.can_view_checklist(c)));
create policy cl_sched_tg_write on public.checklist_schedule_targets for all
  using (exists (select 1 from public.checklist_schedules s join public.checklists c on c.id = s.checklist_id where s.id = schedule_id and public.can_edit_checklist(c.tenant_id, c.created_by)))
  with check (exists (select 1 from public.checklist_schedules s join public.checklists c on c.id = s.checklist_id where s.id = schedule_id and public.can_edit_checklist(c.tenant_id, c.created_by)));

-- runs
create policy cl_runs_select on public.checklist_runs for select using (
  public.is_tenant_member(tenant_id) and (
    public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
    or executor_id = auth.uid()
    or public.manages_user(executor_id, tenant_id)
    or exists (select 1 from public.checklists c where c.id = checklist_id and c.created_by = auth.uid())
  )
);
create policy cl_runs_insert on public.checklist_runs for insert with check (public.is_tenant_member(tenant_id) and executor_id = auth.uid());
create policy cl_runs_update on public.checklist_runs for update
  using (public.is_tenant_member(tenant_id) and (executor_id = auth.uid() or public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])))
  with check (public.is_tenant_member(tenant_id) and (executor_id = auth.uid() or public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])));
create policy cl_runs_delete on public.checklist_runs for delete using (public.is_tenant_member(tenant_id) and (executor_id = auth.uid() or public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])));

create policy cl_ans_select on public.checklist_run_answers for select using (exists (select 1 from public.checklist_runs r where r.id = run_id));
create policy cl_ans_write on public.checklist_run_answers for all
  using (exists (select 1 from public.checklist_runs r where r.id = run_id and (r.executor_id = auth.uid() or public.has_tenant_role(r.tenant_id, '{owner,admin}'::public.member_role[]))))
  with check (exists (select 1 from public.checklist_runs r where r.id = run_id and (r.executor_id = auth.uid() or public.has_tenant_role(r.tenant_id, '{owner,admin}'::public.member_role[]))));

create policy cl_photos_select on public.checklist_answer_photos for select using (exists (select 1 from public.checklist_runs r where r.id = run_id));
create policy cl_photos_write on public.checklist_answer_photos for all
  using (exists (select 1 from public.checklist_runs r where r.id = run_id and (r.executor_id = auth.uid() or public.has_tenant_role(r.tenant_id, '{owner,admin}'::public.member_role[]))))
  with check (exists (select 1 from public.checklist_runs r where r.id = run_id and (r.executor_id = auth.uid() or public.has_tenant_role(r.tenant_id, '{owner,admin}'::public.member_role[]))));

-- storage bucket
insert into storage.buckets (id, name, public) values ('checklist-photos','checklist-photos', false) on conflict (id) do nothing;
create policy cl_photo_select on storage.objects for select using (bucket_id = 'checklist-photos' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));
create policy cl_photo_insert on storage.objects for insert with check (bucket_id = 'checklist-photos' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));
create policy cl_photo_delete on storage.objects for delete using (bucket_id = 'checklist-photos' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));
