alter table public.tenant_secrets add column if not exists resend_api_key text;
alter table public.tenants add column if not exists has_resend_key boolean not null default false;

create or replace function public.set_resend_key(p_key text, p_clear boolean default false)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant uuid := public.my_active_tenant();
begin
  if v_tenant is null then
    raise exception 'Nenhuma empresa ativa.';
  end if;
  if not public.has_tenant_role(v_tenant, array['owner']::member_role[]) then
    raise exception 'Apenas o proprietário pode configurar a integração de e-mail.';
  end if;

  if p_clear then
    update public.tenant_secrets set resend_api_key = null, updated_at = now() where tenant_id = v_tenant;
    update public.tenants set has_resend_key = false where id = v_tenant;
  elsif coalesce(trim(p_key), '') <> '' then
    insert into public.tenant_secrets (tenant_id, resend_api_key, updated_at)
    values (v_tenant, trim(p_key), now())
    on conflict (tenant_id) do update set resend_api_key = excluded.resend_api_key, updated_at = now();
    update public.tenants set has_resend_key = true where id = v_tenant;
  end if;
end;
$function$;

notify pgrst, 'reload schema';
