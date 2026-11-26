"use server";

/**
 * Equipes do setor (LUIZ, 26/11/2026): muda gestor e/ou subsetor de uma ou
 * mais pessoas, com data. Quem pode e sobre quem é decidido no banco
 * (`equipe_transferir`): owner/admin/DP em qualquer setor; quem tem a marca
 * "Ajusta equipes do setor", só no próprio setor e com gestor do setor.
 */

import { revalidatePath } from "next/cache";
import { actionContext, dpActionContext } from "./context";
import type { ActionState } from "./types";

export async function transferirNaEquipe(input: {
  membros: string[];
  subsetorId: string | null;
  gestorId: string | null;
  /** AAAA-MM-DD */
  data: string;
}): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.data)) return { error: "Informe a data da mudança." };
    const { data, error } = await supabase.rpc("equipe_transferir", {
      p_tenant: tenantId,
      p_membros: input.membros,
      p_subsetor: input.subsetorId,
      p_gestor: input.gestorId,
      p_data: input.data,
    });
    if (error) return { error: error.message };
    const r = (data ?? {}) as { movidos?: number; semMudanca?: number };
    revalidatePath("/configuracoes");
    const movidos = r.movidos ?? 0;
    const iguais = r.semMudanca ?? 0;
    const partes = [`${movidos} colaborador(es) transferido(s)`];
    if (iguais > 0) partes.push(`${iguais} já estava(m) assim`);
    return { ok: true, message: `${partes.join(", ")}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * As funções da carteira de um setor (nome base, sem o nível). Só owner, admin
 * e DP; lista vazia volta a mostrar o setor inteiro.
 */
export async function salvarFuncoesDaCarteira(setorId: string, funcoes: string[]): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await dpActionContext();
    const { error } = await supabase.from("equipe_setor_config").upsert(
      { tenant_id: tenantId, department_id: setorId, funcoes, updated_by: userId },
      { onConflict: "tenant_id,department_id" },
    );
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    return { ok: true, message: "Funções da carteira salvas." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
