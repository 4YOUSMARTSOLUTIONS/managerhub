"use server";

import { actionContext } from "./context";
import type { ActionState } from "./types";
import { createServiceClient } from "@/lib/supabase/admin";
import { obterVapid } from "@/lib/push-servidor";
import { endpointValido } from "@/lib/web-push";

/**
 * Notificações no celular deste aparelho. Quem decide a quem pertence a
 * inscrição é o banco (`push_inscrever` usa o auth.uid() da sessão); aqui só
 * se confere a sessão e se repassa.
 */

const msg = (e: unknown) => (e instanceof Error ? e.message : "Não foi possível concluir.");

/** A chave pública que o navegador precisa para inscrever o aparelho. */
export async function prepararPush(): Promise<{ chave?: string; error?: string }> {
  try {
    await actionContext();
    const vapid = await obterVapid(createServiceClient(), true);
    if (!vapid) return { error: "Notificações indisponíveis no momento." };
    return { chave: vapid.publica };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function registrarPush(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  aparelho: string;
}): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    if (!endpointValido(input.endpoint)) return { error: "Este navegador usa um serviço de notificação não reconhecido." };
    const { error } = await supabase.rpc("push_inscrever", {
      p_endpoint: input.endpoint, p_p256dh: input.p256dh, p_auth: input.auth, p_aparelho: input.aparelho,
    });
    if (error) return { error: error.message };
    // o aviso de confirmação faz o caminho inteiro (banco → app → celular)
    await supabase.rpc("push_teste", { p_tenant: tenantId });
    return { ok: true };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function cancelarPush(endpoint: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("push_cancelar", { p_endpoint: endpoint });
    if (error) return { error: error.message };
    return { ok: true };
  } catch (e) {
    return { error: msg(e) };
  }
}

/** Marca o aparelho como em uso (ver avisarUsoDoAparelho). */
export async function pushEmUso(endpoint: string): Promise<void> {
  try {
    const { supabase } = await actionContext();
    await supabase.rpc("push_em_uso", { p_endpoint: endpoint });
  } catch {
    // sessão expirada: o controle de inatividade cuida da saída
  }
}

/** O aparelho está ligado para a pessoa logada (e não para quem usou antes)? */
export async function statusPush(endpoint: string): Promise<boolean> {
  try {
    const { supabase } = await actionContext();
    const { data } = await supabase.rpc("push_status", { p_endpoint: endpoint });
    return data === true;
  } catch {
    return false;
  }
}
