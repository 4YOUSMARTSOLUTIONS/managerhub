-- Auditoria de reuniões cadastradas (TOR): loga criação/edição/exclusão
create trigger meeting_series_audit
  after insert or update or delete on public.meeting_series
  for each row execute function public.audit_trigger();

-- Restringe edição/exclusão ao dono da reunião, admin ou owner
drop policy if exists meeting_series_rw on public.meeting_series;

create policy meeting_series_select on public.meeting_series
  for select using (public.is_tenant_member(tenant_id));

create policy meeting_series_insert on public.meeting_series
  for insert with check (public.is_tenant_member(tenant_id));

create policy meeting_series_update on public.meeting_series
  for update
  using (public.is_tenant_member(tenant_id) and (
    public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]) or owner_user_id = auth.uid()
  ))
  with check (public.is_tenant_member(tenant_id) and (
    public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]) or owner_user_id = auth.uid()
  ));

create policy meeting_series_delete on public.meeting_series
  for delete
  using (public.is_tenant_member(tenant_id) and (
    public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]) or owner_user_id = auth.uid()
  ));
