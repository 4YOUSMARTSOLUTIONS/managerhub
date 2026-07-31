-- Configurações de integração da PLATAFORMA (chaves do owner do sistema), uma linha só.
create table if not exists public.platform_settings (
  id boolean primary key default true,
  openai_api_key text,
  resend_api_key text,
  openai_model text not null default 'gpt-4.1-mini',
  openai_transcribe_model text not null default 'gpt-4o-mini-transcribe',
  updated_at timestamptz not null default now(),
  constraint platform_settings_singleton check (id = true)
);

insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

-- RLS ligada e SEM policy: nenhum usuário (nem anon nem authenticated) lê/escreve.
-- Só o service role (bypassa RLS) e as RPCs SECURITY DEFINER abaixo acessam.
alter table public.platform_settings enable row level security;

-- Seed: aproveita as chaves/modelos que o owner já tinha no tenant dele.
update public.platform_settings ps set
  openai_api_key = coalesce(ps.openai_api_key,
    (select ts.openai_api_key from public.tenant_secrets ts where ts.openai_api_key is not null order by ts.updated_at desc limit 1)),
  resend_api_key = coalesce(ps.resend_api_key,
    (select ts.resend_api_key from public.tenant_secrets ts where ts.resend_api_key is not null order by ts.updated_at desc limit 1)),
  openai_model = coalesce(
    (select t.openai_model from public.tenants t where t.has_openai_key and t.openai_model is not null limit 1), ps.openai_model),
  openai_transcribe_model = coalesce(
    (select t.openai_transcribe_model from public.tenants t where t.has_openai_key and t.openai_transcribe_model is not null limit 1), ps.openai_transcribe_model),
  updated_at = now()
where ps.id = true;

-- Escrita: só o super admin (owner do sistema).
create or replace function public.platform_set_openai(p_key text, p_model text, p_transcribe_model text, p_clear boolean default false)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_super_admin() then raise exception 'Apenas o proprietário do sistema pode configurar integrações'; end if;
  update public.platform_settings set
    openai_api_key = case when p_clear then null when coalesce(trim(p_key),'') <> '' then trim(p_key) else openai_api_key end,
    openai_model = coalesce(nullif(trim(p_model),''), openai_model),
    openai_transcribe_model = coalesce(nullif(trim(p_transcribe_model),''), openai_transcribe_model),
    updated_at = now()
  where id = true;
end; $$;

create or replace function public.platform_set_resend(p_key text, p_clear boolean default false)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_super_admin() then raise exception 'Apenas o proprietário do sistema pode configurar integrações'; end if;
  update public.platform_settings set
    resend_api_key = case when p_clear then null when coalesce(trim(p_key),'') <> '' then trim(p_key) else resend_api_key end,
    updated_at = now()
  where id = true;
end; $$;

-- Flags SEM segredo (booleanos + modelos), seguras para qualquer usuário autenticado ler.
create or replace function public.platform_integration_flags()
returns jsonb language sql security definer stable set search_path to 'public' as $$
  select jsonb_build_object(
    'has_openai_key', (openai_api_key is not null and length(trim(openai_api_key)) > 0),
    'has_resend_key', (resend_api_key is not null and length(trim(resend_api_key)) > 0),
    'openai_model', openai_model,
    'openai_transcribe_model', openai_transcribe_model
  ) from public.platform_settings where id = true;
$$;
