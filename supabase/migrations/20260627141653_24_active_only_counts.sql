
-- platform_companies: members_count só conta ativos
drop function if exists public.platform_companies();
create function public.platform_companies()
returns table (
  id uuid, name text, slug text,
  status tenant_status, created_at timestamptz,
  members_count bigint, units_count bigint, units_limit integer
)
language sql security definer stable set search_path = public as $$
  select
    t.id, t.name, t.slug, t.status, t.created_at,
    (select count(*) from public.memberships m where m.tenant_id = t.id and m.is_active = true),
    (select count(*) from public.units u where u.tenant_id = t.id),
    t.units_limit
  from public.tenants t
  where public.is_super_admin()
  order by t.created_at desc;
$$;
revoke all on function public.platform_companies() from public, anon;
grant execute on function public.platform_companies() to authenticated;

-- platform_stats: conta apenas usuários ativos
drop function if exists public.platform_stats();
create function public.platform_stats()
returns json language sql security definer stable set search_path = public as $$
  select json_build_object(
    'companies_total',     (select count(*) from public.tenants),
    'companies_active',    (select count(*) from public.tenants where status = 'active'),
    'companies_suspended', (select count(*) from public.tenants where status = 'suspended'),
    'companies_inactive',  (select count(*) from public.tenants where status = 'inactive'),
    'users_total',    (select count(*) from public.memberships where is_active = true),
    'users_distinct', (select count(distinct user_id) from public.memberships where is_active = true)
  )
  where public.is_super_admin();
$$;
revoke all on function public.platform_stats() from public, anon;
grant execute on function public.platform_stats() to authenticated;

-- dashboard_stats: members só conta ativos
drop function if exists public.dashboard_stats(uuid);
create function public.dashboard_stats(p_tenant uuid)
returns json language plpgsql security definer stable set search_path = public as $$
declare
  v json;
begin
  if not public.is_tenant_member(p_tenant) then
    raise exception 'Sem permissão';
  end if;
  select json_build_object(
    'members',        (select count(*) from public.memberships  where tenant_id = p_tenant and is_active = true),
    'rooms',          (select count(*) from public.rooms        where tenant_id = p_tenant and is_active = true),
    'meetings_today', (select count(*) from public.meetings     where tenant_id = p_tenant
                        and starts_at::date = current_date and status != 'cancelled'),
    'open_actions',   (select count(*) from public.action_items where tenant_id = p_tenant
                        and status not in ('done','cancelled')),
    'open_tickets',   (select count(*) from public.tickets      where tenant_id = p_tenant
                        and status not in ('resolved','closed','cancelled'))
  ) into v;
  return v;
end;
$$;
revoke all on function public.dashboard_stats(uuid) from public, anon;
grant execute on function public.dashboard_stats(uuid) to authenticated;

notify pgrst, 'reload schema';

