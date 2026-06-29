import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Cliente com service role — IGNORA RLS. Use SOMENTE no servidor e apenas
 * para leituras/escritas que precisam contornar o RLS de forma controlada
 * (ex.: ler a chave da OpenAI em `tenant_secrets`, que nenhum usuário pode ler).
 * Nunca exponha o resultado sensível ao cliente.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Integração indisponível: SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
