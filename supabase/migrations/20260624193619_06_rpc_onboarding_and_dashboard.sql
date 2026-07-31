
-- =============================================================
-- MANAGERHUB · Migration 06 · RPCs (onboarding + dashboard)
-- =============================================================

-- Cria empresa e já vincula o usuário atual como owner (atômico, ignora RLS)
create or replace function public.create_tenant_with_owner(p_name text, p_slug text)
returns public.tenants
language plpgsql security definer set search_path = public as $$
declare
  v_tenant public.tenants;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.tenants (name, slug)
  values (p_name, p_slug)
  returning * into v_tenant;

  insert into public.memberships (tenant_id, user_id, role)
  values (v_tenant.id, auth.uid(), 'owner');

  return v_tenant;
end;
$$;

-- KPIs consolidados do dashboard para um tenant
create or replace function public.dashboard_stats(p_tenant uuid)
returns jsonb
language sql security definer stable set search_path = public as $$
  select case when public.is_tenant_member(p_tenant) then jsonb_build_object(
    'rooms_total',        (select count(*) from public.rooms where tenant_id = p_tenant and is_active),
    'meetings_upcoming',  (select count(*) from public.meetings where tenant_id = p_tenant and status = 'scheduled' and starts_at >= now()),
    'meetings_today',     (select count(*) from public.meetings where tenant_id = p_tenant and starts_at::date = now()::date and status <> 'cancelled'),
    'actions_open',       (select count(*) from public.action_items where tenant_id = p_tenant and status in ('open','in_progress','blocked')),
    'actions_overdue',    (select count(*) from public.action_items where tenant_id = p_tenant and status in ('open','in_progress','blocked') and due_date < now()::date),
    'tickets_open',       (select count(*) from public.tickets where tenant_id = p_tenant and status in ('open','in_progress','waiting')),
    'tickets_overdue',    (select count(*) from public.tickets where tenant_id = p_tenant and status in ('open','in_progress','waiting') and due_date < now()::date),
    'goals_active',       (select count(*) from public.goals where tenant_id = p_tenant and status = 'active'),
    'goals_at_risk',      (select count(*) from public.goals where tenant_id = p_tenant and status = 'at_risk'),
    'goals_achieved',     (select count(*) from public.goals where tenant_id = p_tenant and status = 'achieved'),
    'members_total',      (select count(*) from public.memberships where tenant_id = p_tenant)
  ) else '{}'::jsonb end;
$$;

grant execute on function public.create_tenant_with_owner(text, text) to authenticated;
grant execute on function public.dashboard_stats(uuid) to authenticated;

