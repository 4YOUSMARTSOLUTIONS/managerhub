"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

/**
 * Férias e afastamentos do colaborador.
 *
 * Só owner/admin, a mesma regra da vigência de remuneração variável: é aqui que
 * se decide quantos dias do mês entram na conta da RV, então mexer nisto é mexer
 * no que a pessoa recebe.
 *
 * Os dois `revalidatePath` são obrigatórios: o cadastro vive em Configurações,
 * mas quem consome é a tela de Metas.
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const SO_ADMIN = "Apenas proprietário e administrador lançam férias e afastamentos.";

export type AbsenceInput = {
  /** ausente = criar */
  id?: string;
  user_id: string;
  kind: Enums<"absence_kind">;
  start_date: string;
  end_date: string;
  discounts_rv: boolean;
  note?: string | null;
};

/** Traduz o erro do banco em algo que a pessoa entenda na tela. */
function mensagem(e: { code?: string; message?: string }): string {
  const cod = e.code ?? "";
  const msg = e.message ?? "";
  if (cod === "23P01" || msg.includes("employee_absences_sem_sobreposicao")) {
    return "Já existe um período lançado para este colaborador que se sobrepõe a este.";
  }
  if (cod === "23514" || msg.includes("employee_absences_periodo")) {
    return "A data de fim não pode ser anterior à de início.";
  }
  return msg || "Não foi possível salvar.";
}

export async function upsertAbsence(input: AbsenceInput): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId, role } = await actionContext();
    if (role !== "owner" && role !== "admin") return { error: SO_ADMIN };

    const start_date = (input.start_date ?? "").trim();
    const end_date = (input.end_date ?? "").trim();
    if (!input.user_id) return { error: "Escolha o colaborador." };
    if (!DATA.test(start_date) || !DATA.test(end_date)) return { error: "Informe as datas de início e de fim." };
    if (end_date < start_date) return { error: "A data de fim não pode ser anterior à de início." };

    // A RLS confere o tenant da LINHA, e o tenant vem daqui, do servidor. O que
    // ela não confere é se a PESSOA é desta empresa: sem isto daria para gravar
    // uma ausência no id de alguém de outro tenant.
    const { data: vinculo } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", input.user_id)
      .maybeSingle();
    if (!vinculo) return { error: "Colaborador não encontrado nesta empresa." };

    const payload = {
      tenant_id: tenantId,
      user_id: input.user_id,
      kind: input.kind,
      start_date,
      end_date,
      discounts_rv: !!input.discounts_rv,
      note: (input.note ?? "").trim() || null,
      created_by: userId,
    };

    const { error } = input.id
      ? await supabase.from("employee_absences").update(payload).eq("id", input.id)
      : await supabase.from("employee_absences").insert(payload);
    if (error) return { error: mensagem(error) };

    revalidatePath("/configuracoes");
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteAbsence(id: string): Promise<ActionState> {
  try {
    const { supabase, role } = await actionContext();
    if (role !== "owner" && role !== "admin") return { error: SO_ADMIN };
    const { error } = await supabase.from("employee_absences").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
