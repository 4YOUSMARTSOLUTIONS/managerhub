-- Modelo de leitura de imagens (LUIZ, 12/11/2026): a leitura de atestados com
-- IA usa um modelo próprio, escolhido em Admin > Integrações, separado do
-- modelo de texto (reuniões). Padrão gpt-4.1: lê documento e letra de mão
-- melhor que o mini e responde rápido.

alter table public.platform_settings
  add column openai_vision_model text not null default 'gpt-4.1';

-- a gravação ganha o parâmetro novo (assinatura nova: a antiga sai)
drop function if exists public.platform_set_openai(text, text, text, boolean);

create or replace function public.platform_set_openai(
  p_key text, p_model text, p_transcribe_model text, p_clear boolean default false, p_vision_model text default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then raise exception 'Apenas o proprietário do sistema pode configurar integrações'; end if;
  update public.platform_settings set
    openai_api_key = case when p_clear then null when coalesce(trim(p_key),'') <> '' then trim(p_key) else openai_api_key end,
    openai_model = coalesce(nullif(trim(p_model),''), openai_model),
    openai_transcribe_model = coalesce(nullif(trim(p_transcribe_model),''), openai_transcribe_model),
    openai_vision_model = coalesce(nullif(trim(p_vision_model),''), openai_vision_model),
    updated_at = now()
  where id = true;
end; $function$;

revoke execute on function public.platform_set_openai(text, text, text, boolean, text) from public, anon;

-- as flags (sem segredo) levam o modelo de imagem
create or replace function public.platform_integration_flags()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'has_openai_key', (openai_api_key is not null and length(trim(openai_api_key)) > 0),
    'has_resend_key', (resend_api_key is not null and length(trim(resend_api_key)) > 0),
    'openai_model', openai_model,
    'openai_transcribe_model', openai_transcribe_model,
    'openai_vision_model', openai_vision_model
  ) from public.platform_settings where id = true;
$function$;

revoke execute on function public.platform_integration_flags() from public, anon;

notify pgrst, 'reload schema';
