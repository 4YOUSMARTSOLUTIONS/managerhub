-- 1) Coluna de privacidade (default público)
alter table public.meeting_series add column if not exists is_private boolean not null default false;

-- 2) Helper: quem pode VER uma reunião
create or replace function public.can_view_series(s public.meeting_series)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_tenant_member(s.tenant_id) and (
    s.is_private = false
    or public.has_tenant_role(s.tenant_id, '{owner,manager}'::public.member_role[])  -- owner + gerencial (admin NÃO)
    or s.owner_user_id = auth.uid()
    or s.created_by = auth.uid()
    or exists (select 1 from public.meeting_series_participants p
               where p.series_id = s.id and p.user_id = auth.uid())
  );
$$;

-- 3) Helper: quem pode VER uma ação (herda a privacidade da reunião vinculada)
create or replace function public.can_view_action(a public.actions)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_tenant_member(a.tenant_id) and (
    a.meeting_series_id is null
    or exists (select 1 from public.meeting_series s where s.id = a.meeting_series_id and public.can_view_series(s.*))
    or a.requester_id = auth.uid()
    or a.created_by = auth.uid()
    or exists (select 1 from public.action_cc c where c.action_id = a.id and c.user_id = auth.uid())
    or exists (select 1 from public.action_demandas d
               join public.action_demanda_assignees x on x.demanda_id = d.id
               where d.action_id = a.id and x.user_id = auth.uid())
  );
$$;

-- 4) RLS: meeting_series (select por visibilidade; edição privacidade-aware)
drop policy if exists meeting_series_select on public.meeting_series;
create policy meeting_series_select on public.meeting_series for select
  using (public.can_view_series(meeting_series.*));

drop policy if exists meeting_series_update on public.meeting_series;
create policy meeting_series_update on public.meeting_series for update
  using (public.is_tenant_member(tenant_id) and (
    owner_user_id = auth.uid()
    or public.has_tenant_role(tenant_id, '{owner}'::public.member_role[])
    or (is_private = false and public.has_tenant_role(tenant_id, '{admin}'::public.member_role[]))
    or (is_private = true  and public.has_tenant_role(tenant_id, '{manager}'::public.member_role[]))
  ))
  with check (public.is_tenant_member(tenant_id) and (
    owner_user_id = auth.uid()
    or public.has_tenant_role(tenant_id, '{owner}'::public.member_role[])
    or (is_private = false and public.has_tenant_role(tenant_id, '{admin}'::public.member_role[]))
    or (is_private = true  and public.has_tenant_role(tenant_id, '{manager}'::public.member_role[]))
  ));

drop policy if exists meeting_series_delete on public.meeting_series;
create policy meeting_series_delete on public.meeting_series for delete
  using (public.is_tenant_member(tenant_id) and (
    owner_user_id = auth.uid()
    or public.has_tenant_role(tenant_id, '{owner}'::public.member_role[])
    or (is_private = false and public.has_tenant_role(tenant_id, '{admin}'::public.member_role[]))
    or (is_private = true  and public.has_tenant_role(tenant_id, '{manager}'::public.member_role[]))
  ));

-- 5) RLS: ocorrências, participantes, unidades, presença (cascata para can_view_series)
drop policy if exists meeting_occurrences_rw on public.meeting_occurrences;
create policy meeting_occurrences_rw on public.meeting_occurrences for all
  using (exists (select 1 from public.meeting_series s where s.id = meeting_occurrences.series_id and public.can_view_series(s.*)))
  with check (exists (select 1 from public.meeting_series s where s.id = meeting_occurrences.series_id and public.can_view_series(s.*)));

drop policy if exists msp_rw on public.meeting_series_participants;
create policy msp_rw on public.meeting_series_participants for all
  using (exists (select 1 from public.meeting_series s where s.id = meeting_series_participants.series_id and public.can_view_series(s.*)))
  with check (exists (select 1 from public.meeting_series s where s.id = meeting_series_participants.series_id and public.can_view_series(s.*)));

drop policy if exists msu_rw on public.meeting_series_units;
create policy msu_rw on public.meeting_series_units for all
  using (exists (select 1 from public.meeting_series s where s.id = meeting_series_units.series_id and public.can_view_series(s.*)))
  with check (exists (select 1 from public.meeting_series s where s.id = meeting_series_units.series_id and public.can_view_series(s.*)));

drop policy if exists attendance_rw on public.meeting_attendance;
create policy attendance_rw on public.meeting_attendance for all
  using (exists (select 1 from public.meeting_occurrences o join public.meeting_series s on s.id = o.series_id
                 where o.id = meeting_attendance.occurrence_id and public.can_view_series(s.*)))
  with check (exists (select 1 from public.meeting_occurrences o join public.meeting_series s on s.id = o.series_id
                 where o.id = meeting_attendance.occurrence_id and public.can_view_series(s.*)));

-- 6) RLS: actions + tabelas filhas (via can_view_action)
drop policy if exists actions_rw on public.actions;
create policy actions_select on public.actions for select using (public.can_view_action(actions.*));
create policy actions_insert on public.actions for insert with check (public.is_tenant_member(tenant_id));
create policy actions_update on public.actions for update
  using (public.can_view_action(actions.*)) with check (public.is_tenant_member(tenant_id));
create policy actions_delete on public.actions for delete using (public.can_view_action(actions.*));

drop policy if exists action_demandas_rw on public.action_demandas;
create policy action_demandas_rw on public.action_demandas for all
  using (exists (select 1 from public.actions a where a.id = action_demandas.action_id and public.can_view_action(a.*)))
  with check (exists (select 1 from public.actions a where a.id = action_demandas.action_id and public.can_view_action(a.*)));

drop policy if exists action_cc_rw on public.action_cc;
create policy action_cc_rw on public.action_cc for all
  using (exists (select 1 from public.actions a where a.id = action_cc.action_id and public.can_view_action(a.*)))
  with check (exists (select 1 from public.actions a where a.id = action_cc.action_id and public.can_view_action(a.*)));

drop policy if exists action_attachments_rw on public.action_attachments;
create policy action_attachments_rw on public.action_attachments for all
  using (exists (select 1 from public.actions a where a.id = action_attachments.action_id and public.can_view_action(a.*)))
  with check (exists (select 1 from public.actions a where a.id = action_attachments.action_id and public.can_view_action(a.*)));

drop policy if exists ada_rw on public.action_demanda_assignees;
create policy ada_rw on public.action_demanda_assignees for all
  using (exists (select 1 from public.action_demandas d join public.actions a on a.id = d.action_id
                 where d.id = action_demanda_assignees.demanda_id and public.can_view_action(a.*)))
  with check (exists (select 1 from public.action_demandas d join public.actions a on a.id = d.action_id
                 where d.id = action_demanda_assignees.demanda_id and public.can_view_action(a.*)));
