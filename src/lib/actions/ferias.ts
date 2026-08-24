"use server";

import { revalidatePath } from "next/cache";
import { actionContext, dpActionContext } from "./context";
import type { ActionState } from "./types";
import type { Json } from "@/types/database";

/**
 * Férias: o PROCESSO da previsão (solicitação -> aprovação do gestor ->
 * efetivação do DP), com as regras CLT validadas no banco.
 *
 * As actions são finas de propósito: contexto -> RPC -> revalidate. Toda a
 * autorização mora nas funções `ferias_*` (security definer com guarda no
 * corpo) e no guard de transições; aqui só se traduz o transporte. O `hoje`
 * viaja do CLIENTE porque o servidor está em UTC e às 21h de Brasília o
 * `current_date` do banco já virou (lição do occurred_on do absenteísmo).
 */

const RP_FERIAS = "/ferias";

function revalidar() {
  revalidatePath(RP_FERIAS);
}

/** Efetivar e desfazer efetivada mexem em `employee_absences`, que a RV lê. */
function revalidarComRv() {
  revalidar();
  revalidatePath("/metas");
  revalidatePath("/configuracoes");
}

export type PeriodoFerias = {
  inicio: string;
  fim: string;
  abono: number;
  decimo: boolean;
};

function comoJson(periodos: PeriodoFerias[]): Json {
  return periodos.map((p) => ({
    inicio: p.inicio, fim: p.fim, abono: p.abono, decimo: p.decimo,
  }));
}

export async function solicitarFerias(
  input: { periodos: PeriodoFerias[]; hoje: string },
): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    const { error } = await supabase.rpc("ferias_solicitar", {
      p_tenant: tenantId, p_periodos: comoJson(input.periodos), p_hoje: input.hoje,
    });
    if (error) return { error: error.message };
    revalidar();
    return { ok: true, message: "Solicitação enviada ao seu gestor." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function lancarFerias(
  input: { userId: string; periodos: PeriodoFerias[]; hoje: string },
): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    const { error } = await supabase.rpc("ferias_lancar", {
      p_tenant: tenantId, p_user: input.userId,
      p_periodos: comoJson(input.periodos), p_hoje: input.hoje,
    });
    if (error) return { error: error.message };
    revalidar();
    return { ok: true, message: "Previsão lançada e enviada ao departamento pessoal." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function decidirFerias(
  input: { id: string; aprovar: boolean; nota?: string },
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("ferias_decidir", {
      p_id: input.id, p_aprovar: input.aprovar, p_nota: input.nota?.trim() || null,
    });
    if (error) return { error: error.message };
    revalidar();
    return { ok: true, message: input.aprovar ? "Previsão aprovada." : "Previsão devolvida." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function reenviarFerias(
  input: { id: string; inicio: string; fim: string; abono: number; decimo: boolean; hoje: string },
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("ferias_reenviar", {
      p_id: input.id, p_inicio: input.inicio, p_fim: input.fim,
      p_abono: input.abono, p_decimo: input.decimo, p_hoje: input.hoje,
    });
    if (error) return { error: error.message };
    revalidar();
    return { ok: true, message: "Previsão corrigida e reenviada." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function cancelarFerias(
  input: { id: string; nota: string },
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("ferias_cancelar", {
      p_id: input.id, p_nota: input.nota.trim() || null,
    });
    if (error) return { error: error.message };
    // pode ter desfeito uma efetivada (a RPC decide pela alçada)
    revalidarComRv();
    return { ok: true, message: "Previsão cancelada." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function efetivarFerias(
  input: { id: string; descontaRv: boolean; nota?: string },
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("ferias_efetivar", {
      p_id: input.id, p_desconta_rv: input.descontaRv, p_nota: input.nota?.trim() || null,
    });
    if (error) return { error: error.message };
    revalidarComRv();
    return { ok: true, message: "Férias efetivadas." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function reagendarFerias(
  input: { id: string; inicio: string; fim: string; abono: number; decimo: boolean; hoje: string },
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("ferias_reagendar", {
      p_id: input.id, p_inicio: input.inicio, p_fim: input.fim,
      p_abono: input.abono, p_decimo: input.decimo, p_hoje: input.hoje,
    });
    if (error) return { error: error.message };
    revalidar();
    return { ok: true, message: "Reagendamento enviado. As férias atuais continuam valendo até a verificação do DP." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type ContextoEfetivacao = {
  faltasQtd: number;
  faltasDias: number;
  direitoArt130: number;
  saldo: number | null;
  abonoUsado: number | null;
  qtdPeriodos: number | null;
  situacao: string | null;
  concessivoFim: string | null;
  irmas: { id: string; inicio: string; fim: string; dias: number; abono: number; status: string }[];
};

/** O informativo que o DP olha antes de efetivar (faltas art. 130, saldo, irmãs). */
export async function getContextoEfetivacao(id: string): Promise<ContextoEfetivacao | null> {
  const { supabase } = await actionContext();
  const { data, error } = await supabase.rpc("ferias_contexto_efetivacao", { p_id: id });
  if (error || !data) return null;
  return data as unknown as ContextoEfetivacao;
}

/** Excluir é limpeza administrativa: a RLS só deixa o proprietário. */
export async function excluirFerias(id: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error, count } = await supabase
      .from("ferias_solicitacoes")
      .delete({ count: "exact" })
      .eq("id", id);
    if (error) return { error: error.message };
    if (!count) return { error: "Apenas o proprietário exclui um registro de férias." };
    revalidar();
    return { ok: true, message: "Registro excluído." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Configuração: marca ou desmarca um nível de hierarquia como "não solicita". */
export async function setNivelSolicitaFerias(
  input: { hierarchyLevelId: string; solicita: boolean },
): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await dpActionContext();
    if (input.solicita) {
      const { error } = await supabase
        .from("ferias_niveis_bloqueados")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("hierarchy_level_id", input.hierarchyLevelId);
      if (error) return { error: error.message };
    } else {
      const { error } = await supabase
        .from("ferias_niveis_bloqueados")
        .insert({ tenant_id: tenantId, hierarchy_level_id: input.hierarchyLevelId });
      if (error && !error.message.includes("duplicate")) return { error: error.message };
    }
    revalidar();
    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
