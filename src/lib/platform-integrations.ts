import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Integrações são CENTRALIZADAS na plataforma (contas do owner do sistema),
 * guardadas em `platform_settings` (RLS sem policy: só service role/RPC acessam).
 * As chaves valem para todas as empresas; nenhum usuário de empresa lê o valor.
 */

/** Lê a chave/modelo da OpenAI (valor sensível — SOMENTE no servidor). */
export async function getPlatformOpenAI(): Promise<{ apiKey: string; model: string; transcribeModel: string }> {
  const admin = createServiceClient();
  const { data } = await admin
    .from("platform_settings")
    .select("openai_api_key, openai_model, openai_transcribe_model")
    .eq("id", true)
    .maybeSingle();
  return {
    apiKey: (data?.openai_api_key ?? "").trim(),
    model: (data?.openai_model ?? "gpt-4.1-mini").trim(),
    transcribeModel: (data?.openai_transcribe_model ?? "gpt-4o-mini-transcribe").trim(),
  };
}

/** Lê a chave do Resend (valor sensível — SOMENTE no servidor). */
export async function getPlatformResend(): Promise<{ apiKey: string }> {
  const admin = createServiceClient();
  const { data } = await admin
    .from("platform_settings")
    .select("resend_api_key")
    .eq("id", true)
    .maybeSingle();
  return { apiKey: (data?.resend_api_key ?? "").trim() };
}

export type PlatformIntegrationFlags = {
  hasOpenAI: boolean;
  hasResend: boolean;
  openaiModel: string;
  openaiTranscribeModel: string;
};

/**
 * Flags SEM o segredo (booleanos + modelos), para UI e gating de features.
 * Usa a RPC `platform_integration_flags` (SECURITY DEFINER, nunca devolve a chave).
 */
export async function getPlatformIntegrationFlags(): Promise<PlatformIntegrationFlags> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("platform_integration_flags");
  const f = (data ?? {}) as {
    has_openai_key?: boolean; has_resend_key?: boolean;
    openai_model?: string; openai_transcribe_model?: string;
  };
  return {
    hasOpenAI: !!f.has_openai_key,
    hasResend: !!f.has_resend_key,
    openaiModel: f.openai_model ?? "gpt-4.1-mini",
    openaiTranscribeModel: f.openai_transcribe_model ?? "gpt-4o-mini-transcribe",
  };
}
