-- Ver reunião privada: participantes + dono + gerencial(manager) + owner. Criador NÃO vê.
create or replace function public.can_view_series(s public.meeting_series)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_tenant_member(s.tenant_id) and (
    s.is_private = false
    or public.has_tenant_role(s.tenant_id, '{owner,manager}'::public.member_role[])
    or s.owner_user_id = auth.uid()
    or exists (select 1 from public.meeting_series_participants p
               where p.series_id = s.id and p.user_id = auth.uid())
  );
$$;

-- Editar: dono + gerencial + owner sempre; pública → também admin; privada → também participantes. Criador NÃO edita.
drop policy if exists meeting_series_update on public.meeting_series;
create policy meeting_series_update on public.meeting_series for update
  using (public.is_tenant_member(tenant_id) and (
    owner_user_id = auth.uid()
    or public.has_tenant_role(tenant_id, '{owner,manager}'::public.member_role[])
    or (is_private = false and public.has_tenant_role(tenant_id, '{admin}'::public.member_role[]))
    or (is_private = true and exists (select 1 from public.meeting_series_participants p
                                      where p.series_id = meeting_series.id and p.user_id = auth.uid()))
  ))
  with check (public.is_tenant_member(tenant_id) and (
    owner_user_id = auth.uid()
    or public.has_tenant_role(tenant_id, '{owner,manager}'::public.member_role[])
    or (is_private = false and public.has_tenant_role(tenant_id, '{admin}'::public.member_role[]))
    or (is_private = true and exists (select 1 from public.meeting_series_participants p
                                      where p.series_id = meeting_series.id and p.user_id = auth.uid()))
  ));

drop policy if exists meeting_series_delete on public.meeting_series;
create policy meeting_series_delete on public.meeting_series for delete
  using (public.is_tenant_member(tenant_id) and (
    owner_user_id = auth.uid()
    or public.has_tenant_role(tenant_id, '{owner,manager}'::public.member_role[])
    or (is_private = false and public.has_tenant_role(tenant_id, '{admin}'::public.member_role[]))
    or (is_private = true and exists (select 1 from public.meeting_series_participants p
                                      where p.series_id = meeting_series.id and p.user_id = auth.uid()))
  ));
