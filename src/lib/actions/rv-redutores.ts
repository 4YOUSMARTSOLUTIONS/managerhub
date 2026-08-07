"use server";

import { revalidatePath } from "next/cache";
import { adminActionContext } from "./context";
import { wantsActive } from "@/lib/catalogGuard";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

/**
 * Redutores da remuneração variável: catálogo de punições, o registro da
 * punição e as regras/faixas de corte.
 *
 * Tudo aqui é `adminActionContext`, pelo mesmo motivo de `absences.ts` e de
 * `rv-config.ts`: mexer nisto é mexer no que a pessoa recebe. A RLS já recusa,
 * mas recusa em silêncio — um update fora da policy afeta zero linha e volta sem
 * erro.
 *
 * Os dois `revalidatePath` são obrigatórios em toda função: o cadastro vive em
 * Configurações e quem consome é a tela de Metas.
 */

const RP_CONFIG = "/configuracoes";
const RP_METAS = "/metas";
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function revalidar() {
  revalidatePath(RP_CONFIG);
  revalidatePath(RP_METAS);
}

/** Traduz o erro do banco em algo que a pessoa entenda na tela. */
function mensagem(e: { code?: string; message?: string }): string {
  const msg = e.message ?? "";
  if (msg.includes("rv_reducer_bands_sem_sobreposicao")) {
    return "Esta faixa se sobrepõe a outra já cadastrada neste motivo. Ajuste os limites.";
  }
  if (msg.includes("rv_reducer_rules_ausencia_uk") || msg.includes("rv_reducer_rules_punicao")) {
    return "Já existe um motivo para esta origem. Edite o que existe em vez de criar outro.";
  }
  if (msg.includes("sanction_types_nome_unico")) return "Já existe um tipo de punição com esse nome.";
  if (msg.includes("rv_reducer_bands_pct")) return "A redução precisa ficar entre 0% e 100%.";
  if (msg.includes("rv_reducer_bands_max")) return "O limite final não pode ser menor que o inicial.";
  if (msg.includes("employee_sanctions_sanction_type_id_fkey")) {
    return "Este tipo de punição está em uso e não pode ser excluído. Desative-o.";
  }
  return msg || "Não foi possível salvar.";
}

// ---------------------------------------------------- catálogo de punições
export async function createSanctionType(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await adminActionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("sanction_types").insert({ tenant_id: tenantId, name });
  revalidar();
}

export async function setSanctionTypeActive(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  await supabase.from("sanction_types").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidar();
}

export async function deleteSanctionType(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  const id = String(formData.get("id"));
  // Em uso vira desativação, como nos demais catálogos: apagar levaria junto o
  // histórico disciplinar, e a FK é `on delete restrict` justamente por isso.
  const { count } = await supabase
    .from("employee_sanctions").select("id", { count: "exact", head: true }).eq("sanction_type_id", id);
  if ((count ?? 0) > 0) { await setSanctionTypeActive(formData); return; }
  await supabase.from("sanction_types").delete().eq("id", id);
  revalidar();
}

// ------------------------------------------------------ punição aplicada
export type SanctionInput = {
  /** ausente = criar */
  id?: string;
  user_id: string;
  sanction_type_id: string;
  occurred_on: string;
  note?: string | null;
};

export async function upsertSanction(input: SanctionInput): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await adminActionContext();
    const occurred_on = (input.occurred_on ?? "").trim();
    if (!input.user_id) return { error: "Escolha o colaborador." };
    if (!input.sanction_type_id) return { error: "Escolha o tipo de punição." };
    if (!DATA.test(occurred_on)) return { error: "Informe a data da punição." };

    // A RLS confere o tenant da LINHA, e o tenant vem do servidor. O que ela não
    // confere é se a PESSOA é desta empresa: sem isto daria para registrar uma
    // punição no id de alguém de outro tenant.
    const { data: vinc } = await supabase
      .from("memberships").select("id").eq("tenant_id", tenantId).eq("user_id", input.user_id).maybeSingle();
    if (!vinc) return { error: "Colaborador não pertence a esta empresa." };

    const linha = {
      tenant_id: tenantId,
      user_id: input.user_id,
      sanction_type_id: input.sanction_type_id,
      occurred_on,
      note: (input.note ?? "").trim() || null,
    };
    const { error } = input.id
      ? await supabase.from("employee_sanctions").update(linha).eq("id", input.id)
      : await supabase.from("employee_sanctions").insert({ ...linha, created_by: userId });
    if (error) return { error: mensagem(error) };
    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteSanction(id: string): Promise<ActionState> {
  try {
    const { supabase } = await adminActionContext();
    const { error } = await supabase.from("employee_sanctions").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ------------------------------------------------------- motivos e faixas
export type RuleInput = {
  name: string;
  source: Enums<"rv_reducer_source">;
  absence_kind?: Enums<"absence_kind"> | null;
  /** null com source `sanction` = qualquer punição */
  sanction_type_id?: string | null;
};

export async function createReducerRule(input: RuleInput): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Dê um nome ao motivo." };
    if (input.source === "absence" && !input.absence_kind) {
      return { error: "Escolha o tipo de ausência que este motivo observa." };
    }
    const { error } = await supabase.from("rv_reducer_rules").insert({
      tenant_id: tenantId,
      name,
      source: input.source,
      absence_kind: input.source === "absence" ? input.absence_kind ?? null : null,
      sanction_type_id: input.source === "sanction" ? input.sanction_type_id ?? null : null,
    });
    if (error) return { error: mensagem(error) };
    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function toggleReducerRule(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  await supabase.from("rv_reducer_rules").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidar();
}

export async function deleteReducerRule(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  // as faixas caem junto pela FK em cascata
  await supabase.from("rv_reducer_rules").delete().eq("id", String(formData.get("id")));
  revalidar();
}

export async function addReducerBand(input: {
  rule_id: string; min_qtd: number; max_qtd: number | null; reduction_pct: number;
}): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    if (!Number.isFinite(input.min_qtd) || input.min_qtd < 1) return { error: "O limite inicial começa em 1." };
    if (input.max_qtd != null && input.max_qtd < input.min_qtd) {
      return { error: "O limite final não pode ser menor que o inicial." };
    }
    if (!Number.isFinite(input.reduction_pct) || input.reduction_pct < 0 || input.reduction_pct > 100) {
      return { error: "A redução precisa ficar entre 0% e 100%." };
    }
    // O `tenant_id` vem daqui e a FK composta com a regra recusa a combinação
    // errada, então não dá para pendurar uma faixa em regra de outra empresa.
    const { error } = await supabase.from("rv_reducer_bands").insert({
      rule_id: input.rule_id,
      tenant_id: tenantId,
      min_qtd: input.min_qtd,
      max_qtd: input.max_qtd,
      reduction_pct: input.reduction_pct,
    });
    if (error) return { error: mensagem(error) };
    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteReducerBand(id: string): Promise<ActionState> {
  try {
    const { supabase } = await adminActionContext();
    const { error } = await supabase.from("rv_reducer_bands").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
