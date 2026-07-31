-- Empresa ativa do owner de plataforma (super admin). RLS sem policy: só RPC/service role.
create table if not exists public.platform_active_tenant (
  user_id uuid primary key,
  tenant_id uuid references public.tenants(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.platform_active_tenant enable row level security;

-- Super admin define a empresa que está visualizando.
create or replace function public.platform_set_active_tenant(p_tenant uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.is_super_admin() then raise exception 'Sem permissão'; end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then raise exception 'Empresa não encontrada'; end if;
  insert into public.platform_active_tenant (user_id, tenant_id, updated_at)
  values (auth.uid(), p_tenant, now())
  on conflict (user_id) do update set tenant_id = excluded.tenant_id, updated_at = now();
end; $function$;

-- BYPASS DO SUPER ADMIN nas funções centrais de acesso.
-- Cascateia para todos os can_view_*/agenda_can_* (que são is_tenant_member AND (has_tenant_role OR ...)).
create or replace function public.is_tenant_member(p_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select public.is_super_admin() or exists (
    select 1 from public.memberships where user_id = auth.uid() and tenant_id = p_tenant
  );
$function$;

create or replace function public.has_tenant_role(p_tenant uuid, p_roles member_role[])
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select public.is_super_admin() or exists (
    select 1 from public.memberships
    where user_id = auth.uid() and tenant_id = p_tenant and role = any(p_roles)
  );
$function$;

-- Super admin enxerga todas as empresas (para políticas que usam current_tenant_ids).
create or replace function public.current_tenant_ids()
returns setof uuid language sql stable security definer set search_path to 'public' as $function$
  select id from public.tenants where public.is_super_admin()
  union
  select tenant_id from public.memberships where user_id = auth.uid();
$function$;

-- Tenant ativo p/ inferência em RPCs de escrita: super admin usa a empresa selecionada
-- (fallback: primeira empresa); usuário normal usa a primeira membership.
create or replace function public.my_active_tenant()
returns uuid language sql stable security definer set search_path to 'public' as $function$
  select case when public.is_super_admin() then coalesce(
      (select tenant_id from public.platform_active_tenant where user_id = auth.uid()),
      (select id from public.tenants order by created_at limit 1)
    )
    else (select tenant_id from public.memberships where user_id = auth.uid() order by created_at limit 1)
  end;
$function$;
