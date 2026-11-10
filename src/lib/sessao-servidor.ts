import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Minutos sem uso que encerram a sessão de quem está logado (null = sem
 * limite). Erro na leitura cai no padrão de 8 horas: na dúvida, a sessão
 * ainda vence, só que tarde.
 */
export const getMinhaInatividade = cache(async (tenantId: string): Promise<{ minutos: number | null; agoraServidor: number }> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("minha_inatividade", { p_tenant: tenantId });
  // relógio do servidor para o app: o do celular pode estar errado
  const agoraServidor = Date.now();
  if (error) {
    console.error("[sessao] minha_inatividade", error.message);
    return { minutos: 480, agoraServidor };
  }
  return { minutos: typeof data === "number" ? data : null, agoraServidor };
});
