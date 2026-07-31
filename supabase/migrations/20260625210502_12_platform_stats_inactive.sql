
-- Inclui contagem de empresas desativadas nas métricas
create or replace function public.platform_stats()
returns jsonb language sql security definer stable set search_path = public as $$
  select case when public.is_super_admin() then jsonb_build_object(
    'companies_total',     (select count(*) from public.tenants),
    'companies_active',    (select count(*) from public.tenants where status = 'active'),
    'companies_suspended', (select count(*) from public.tenants where status = 'suspended'),
    'companies_inactive',  (select count(*) from public.tenants where status = 'inactive'),
    'users_total',         (select count(*) from public.memberships),
    'users_distinct',      (select count(distinct user_id) from public.memberships)
  ) else '{}'::jsonb end;
$$;

notify pgrst, 'reload schema';

