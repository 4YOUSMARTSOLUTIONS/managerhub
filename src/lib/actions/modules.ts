"use server";

import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./types";

/**
 * Registra o interesse do usuário num módulo bloqueado (vitrine).
 * Os ids vêm de campo oculto, então a RPC revalida no banco: só grava onde o
 * módulo está mesmo `locked` e o usuário é membro do tenant.
 */
export async function registerInterest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const moduleKey = String(formData.get("module_key") ?? "").trim();
    const units = String(formData.get("unit_ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!moduleKey) return { error: "Módulo inválido." };
    if (units.length === 0) return { error: "Nenhuma unidade no seu acesso para registrar o interesse." };

    const supabase = await createClient();
    const { error } = await supabase.rpc("register_module_interest", { p_units: units, p_module: moduleKey });
    if (error) return { error: error.message };

    return { ok: true, message: "Interesse registrado." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
