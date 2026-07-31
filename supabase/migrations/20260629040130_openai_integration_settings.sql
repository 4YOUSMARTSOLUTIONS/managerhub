-- 1. Tabela isolada para a chave da OpenAI (segredo). RLS sem policies: ninguém lê/escreve direto.
create table if not exists public.tenant_secrets (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  openai_api_key text,
  updated_at timestamptz not null default now()
);
alter table public.tenant_secrets enable row level security;
revoke all on public.tenant_secrets from anon, authenticated;

-- 2. Colunas legíveis (não-secretas) em tenants
alter table public.tenants add column if not exists has_openai_key boolean not null default false;
alter table public.tenants add column if not exists openai_model text not null default 'gpt-5.1-mini';

-- 3. RPC owner-only para gravar a chave/modelo
create or replace function public.set_openai_settings(p_key text, p_model text, p_clear boolean default false)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.my_active_tenant();
begin
  if v_tenant is null then
    raise exception 'Nenhuma empresa ativa.';
  end if;
  if not public.has_tenant_role(v_tenant, array['owner']::member_role[]) then
    raise exception 'Apenas o proprietário pode configurar a integração com IA.';
  end if;

  if p_clear then
    delete from public.tenant_secrets where tenant_id = v_tenant;
    update public.tenants set has_openai_key = false where id = v_tenant;
  elsif coalesce(trim(p_key), '') <> '' then
    insert into public.tenant_secrets (tenant_id, openai_api_key, updated_at)
    values (v_tenant, trim(p_key), now())
    on conflict (tenant_id) do update set openai_api_key = excluded.openai_api_key, updated_at = now();
    update public.tenants set has_openai_key = true where id = v_tenant;
  end if;

  update public.tenants
    set openai_model = coalesce(nullif(trim(p_model), ''), openai_model)
    where id = v_tenant;
end;
$$;

revoke all on function public.set_openai_settings(text, text, boolean) from public;
grant execute on function public.set_openai_settings(text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
