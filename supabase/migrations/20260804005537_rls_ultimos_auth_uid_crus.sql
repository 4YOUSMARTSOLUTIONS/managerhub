-- Ultimos auth.uid() sem (select ...). Sem o envelope, o Postgres reavalia a
-- funcao a cada linha lida; com ele vira InitPlan, resolvido uma vez.
-- notifications e a que mais cresce das cinco.
alter policy "notifications_own_select" on public.notifications using (user_id = (select auth.uid()));
alter policy "notifications_own_update" on public.notifications
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "platform_admins_self_select" on public.platform_admins using (user_id = (select auth.uid()));
alter policy "platform_module_flags_select" on public.platform_module_flags using ((select auth.uid()) is not null);
alter policy "tenants_authenticated_insert" on public.tenants with check ((select auth.uid()) is not null);

alter policy "pdic_insert" on public.pdi_action_comments
  with check (author_id = (select auth.uid())
    and exists (select 1 from public.pdi_actions a where a.id = pdi_action_comments.action_id));

alter policy "ag_cmt_insert" on public.agenda_log_comments
  with check (author_id = (select auth.uid())
    and exists (select 1 from public.agenda_logs l join public.agendas a on a.id = l.agenda_id
                where l.id = agenda_log_comments.log_id
                  and public.agenda_can_view(a.tenant_id, a.owner_id, a.responsible_id)));

alter policy "ag_att_insert" on public.agenda_log_attachments
  with check (uploaded_by = (select auth.uid())
    and exists (select 1 from public.agenda_logs l join public.agendas a on a.id = l.agenda_id
                where l.id = agenda_log_attachments.log_id
                  and public.agenda_can_fill(a.tenant_id, a.owner_id, a.responsible_id)));

alter policy "ag_task_write" on public.agenda_tasks
  using (exists (select 1 from public.agendas a where a.id = agenda_tasks.agenda_id
                 and (public.agenda_can_admin(a.tenant_id, a.owner_id)
                      or (a.responsible_id = (select auth.uid()) and a.can_responsible_edit))))
  with check (exists (select 1 from public.agendas a where a.id = agenda_tasks.agenda_id
                 and (public.agenda_can_admin(a.tenant_id, a.owner_id)
                      or (a.responsible_id = (select auth.uid()) and a.can_responsible_edit))));

-- escrita de acoes: o conjunto tambem serve aqui
alter policy "actions_insert" on public.actions
  with check (tenant_id in (select public.my_tenant_ids()));
alter policy "actions_update" on public.actions
  using (public.can_view_action(actions.*))
  with check (tenant_id in (select public.my_tenant_ids()));
