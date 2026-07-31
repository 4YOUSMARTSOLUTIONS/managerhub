
-- Restaura a estrutura completa original de dashboard_stats (migração 24 a havia
-- substituído por uma versão errada). Única mudança vs. original: members_total
-- agora conta apenas memberships ativas.
drop function if exists public.dashboard_stats(uuid);
create function public.dashboard_stats(p_tenant uuid)
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
    'members_total',      (select count(*) from public.memberships where tenant_id = p_tenant and is_active = true)
  ) else '{}'::jsonb end;
$$;
grant execute on function public.dashboard_stats(uuid) to authenticated;

notify pgrst, 'reload schema';

