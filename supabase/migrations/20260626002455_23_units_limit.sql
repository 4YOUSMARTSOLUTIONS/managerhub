
-- Limite de unidades por plano
alter table public.tenants
  add column if not exists units_limit integer null
  check (units_limit is null or units_limit > 0);

-- Trigger que bloqueia insert se limite atingido
create or replace function public.enforce_units_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_limit integer;
  v_count integer;
begin
  select units_limit into v_limit from public.tenants where id = NEW.tenant_id;
  if v_limit is not null then
    select count(*) into v_count from public.units where tenant_id = NEW.tenant_id;
    if v_count >= v_limit then
      raise exception 'Limite de % unidade(s) atingido para este plano. Entre em contato para fazer upgrade.', v_limit
        using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists enforce_units_limit_trg on public.units;
create trigger enforce_units_limit_trg
  before insert on public.units
  for each row execute function public.enforce_units_limit();

-- platform_companies() agora retorna units_count + units_limit
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
    (select count(*) from public.memberships m where m.tenant_id = t.id),
    (select count(*) from public.units u where u.tenant_id = t.id),
    t.units_limit
  from public.tenants t
  where public.is_super_admin()
  order by t.created_at desc;
$$;
revoke all on function public.platform_companies() from public, anon;
grant execute on function public.platform_companies() to authenticated;

-- RPC para o super admin definir o limite
create or replace function public.platform_set_units_limit(p_tenant uuid, p_limit integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'Sem permissão'; end if;
  update public.tenants set units_limit = p_limit where id = p_tenant;
end;
$$;
revoke all on function public.platform_set_units_limit(uuid, integer) from public, anon;
grant execute on function public.platform_set_units_limit(uuid, integer) to authenticated;

notify pgrst, 'reload schema';

