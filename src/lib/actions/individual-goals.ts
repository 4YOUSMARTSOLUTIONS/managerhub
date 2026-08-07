"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { verifyOwnPassword } from "./verify-password";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { souGestorDe } from "@/lib/team";
import { recusaDeUpload, TAMANHO_ANEXO, MIMES_ANEXO } from "@/lib/uploads";

const BUCKET_EVIDENCIA = "goal-evidence";

function isAdminRole(role: Enums<"member_role">) {
  return role === "owner" || role === "admin";
}

type Ctx = {
  supabase: SupabaseClient<Database>;
  tenantId: string;
  userId: string;
  role: Enums<"member_role">;
};

/** true se o usuário atual pode definir/fechar as metas de `ownerId` (admin ou gestor direto). */
async function canManageOwner(ctx: Ctx, ownerId: string | null | undefined): Promise<boolean> {
  if (isAdminRole(ctx.role)) return true;
  if (!ownerId) return false;
  if (ownerId === ctx.userId) return false; // ninguém fecha/define as próprias metas
  return souGestorDe(ctx.supabase, ownerId, ctx.tenantId);
}

async function goalOwner(ctx: Ctx, goalId: string): Promise<string | null> {
  const { data } = await ctx.supabase
    .from("individual_goals")
    .select("owner_id")
    .eq("id", goalId)
    .maybeSingle();
  return data?.owner_id ?? null;
}

export type CreateGoalInput = {
  name: string;
  description?: string;
  unit?: string;
  direction: Enums<"goal_direction">;
  partial_pct?: number | null;
  owner_id?: string;
  /** true = não aceita gravar o realizado sem pelo menos um anexo de evidência */
  evidence_required?: boolean;
};

const numOrNull = (v: number | null | undefined) =>
  v == null || Number.isNaN(Number(v)) ? null : Number(v);

export type CreateGoalResult = { ok: true; id: string } | { error: string };

export async function createIndividualGoal(input: CreateGoalInput): Promise<CreateGoalResult> {
  try {
    const ctx = await actionContext();
    const { supabase, tenantId, userId } = ctx;
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome da meta." };

    // metas só são cadastradas por gestores: admin (qualquer dono) ou o gestor direto do dono
    const owner_id = input.owner_id || "";
    if (!owner_id) return { error: "Selecione o colaborador dono da meta." };
    if (!(await canManageOwner(ctx, owner_id))) {
      return { error: "Você só pode cadastrar metas para os seus colaboradores." };
    }

    const { data, error } = await supabase
      .from("individual_goals")
      .insert({
        tenant_id: tenantId,
        owner_id,
        name,
        description: (input.description ?? "").trim() || null,
        unit: (input.unit ?? "").trim(),
        direction: input.direction,
        partial_pct: numOrNull(input.partial_pct),
        evidence_required: input.evidence_required === true,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };

    revalidatePath("/metas");
    return { ok: true, id: data.id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type UpdateGoalInput = {
  id: string;
  name: string;
  description?: string;
  unit?: string;
  direction: Enums<"goal_direction">;
  partial_pct?: number | null;
  evidence_required?: boolean;
};

export async function updateIndividualGoal(input: UpdateGoalInput): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome da meta." };
    if (!(await canManageOwner(ctx, await goalOwner(ctx, input.id)))) {
      return { error: "Você não tem permissão para editar esta meta." };
    }
    const { error } = await ctx.supabase
      .from("individual_goals")
      .update({
        name,
        description: (input.description ?? "").trim() || null,
        unit: (input.unit ?? "").trim(),
        direction: input.direction,
        partial_pct: numOrNull(input.partial_pct),
        evidence_required: input.evidence_required === true,
      })
      .eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteIndividualGoal(id: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!(await canManageOwner(ctx, await goalOwner(ctx, id)))) {
      return { error: "Você não tem permissão para excluir esta meta." };
    }
    const { error } = await ctx.supabase.from("individual_goals").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type UpsertEntryInput = {
  goal_id: string;
  period: string; // YYYY-MM-01 (competência)
  target_value: number;
  actual_value: number | null;
  weight?: number;
  note?: string;
  partial_value?: number | null; // meta parcial (limiar frouxo) do mês
  rv_value?: number | null; // valor da remuneração variável do mês (null = sem RV)
};

export async function upsertGoalEntry(input: UpsertEntryInput): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { supabase, tenantId, userId } = ctx;
    if (!input.goal_id) return { error: "Meta inválida." };
    if (!input.period) return { error: "Informe a competência." };
    if (input.target_value == null || Number.isNaN(Number(input.target_value))) {
      return { error: "Informe a meta do período." };
    }

    // dono da meta + status atual da apuração
    const owner = await goalOwner(ctx, input.goal_id);
    const canManage = await canManageOwner(ctx, owner);
    if (!(owner === userId || canManage)) {
      return { error: "Você não tem permissão para lançar esta meta." };
    }
    const { data: existing } = await supabase
      .from("individual_goal_entries")
      .select("id, approval_status")
      .eq("goal_id", input.goal_id)
      .eq("period", input.period)
      .maybeSingle();
    if (existing?.approval_status === "aprovada") {
      return { error: "Meta aprovada/fechada. Solicite a reabertura a um adm/owner." };
    }

    const actual =
      input.actual_value == null || Number.isNaN(Number(input.actual_value)) ? null : Number(input.actual_value);

    // EVIDÊNCIA OBRIGATÓRIA: sem anexo, não grava o realizado.
    //
    // A conferência mora aqui, e não só na tela, porque é aqui que o número entra
    // no sistema — venha do diálogo de registrar, do de cadastrar ou de qualquer
    // caminho futuro. E só vale quando há realizado: cadastrar a meta, distribuir
    // peso ou limpar o valor continuam livres, senão o gestor não conseguiria nem
    // criar a meta que exige evidência.
    if (actual != null) {
      const { data: meta } = await supabase
        .from("individual_goals")
        .select("evidence_required")
        .eq("id", input.goal_id)
        .maybeSingle();
      if (meta?.evidence_required) {
        const { count } = existing?.id
          ? await supabase
              .from("individual_goal_entry_attachments")
              .select("id", { count: "exact", head: true })
              .eq("entry_id", existing.id)
          : { count: 0 };
        if (!count) {
          return { error: "Esta meta exige evidência: anexe pelo menos um arquivo antes de registrar o realizado." };
        }
      }
    }

    // ao revisar uma meta reprovada, ela volta a ficar pendente de fechamento
    const reset = existing?.approval_status === "reprovada"
      ? { approval_status: "aberta" as const, reproval_note: null }
      : {};

    const { error } = await supabase.from("individual_goal_entries").upsert(
      {
        tenant_id: tenantId,
        goal_id: input.goal_id,
        period: input.period,
        target_value: Number(input.target_value),
        actual_value: actual,
        weight: Math.max(0, Number(input.weight) || 0),
        note: (input.note ?? "").trim() || null,
        partial_value: numOrNull(input.partial_value),
        rv_value: numOrNull(input.rv_value),
        created_by: userId,
        ...reset,
      },
      { onConflict: "goal_id,period" },
    );
    if (error) return { error: error.message };

    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteGoalEntry(input: { goal_id: string; period: string }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { data: existing } = await ctx.supabase
      .from("individual_goal_entries")
      .select("approval_status")
      .eq("goal_id", input.goal_id)
      .eq("period", input.period)
      .maybeSingle();
    if (existing?.approval_status === "aprovada") {
      return { error: "Meta aprovada/fechada. Reabra com adm/owner para excluir." };
    }
    const { error } = await ctx.supabase
      .from("individual_goal_entries")
      .delete()
      .eq("goal_id", input.goal_id)
      .eq("period", input.period);
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Distribui os pesos das metas de UMA competência (a soma deve ser 100%). */
export async function setEntryWeights(input: { period: string; weights: { goal_id: string; weight: number }[] }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { supabase } = ctx;
    const weights = input.weights ?? [];
    if (!input.period) return { error: "Competência inválida." };
    if (weights.length === 0) return { error: "Nenhuma meta para distribuir." };
    const total = Math.round(weights.reduce((s, w) => s + (Number(w.weight) || 0), 0));
    if (total !== 100) return { error: `A soma dos pesos deve ser 100% (atual: ${total}%).` };

    // pesos são parte da definição da meta: só o gestor/admin do dono ajusta
    const owner = await goalOwner(ctx, weights[0].goal_id);
    if (!(await canManageOwner(ctx, owner))) {
      return { error: "Apenas o gestor pode distribuir os pesos das metas." };
    }
    for (const w of weights) {
      const { data: st } = await supabase
        .from("individual_goal_entries")
        .select("approval_status")
        .eq("goal_id", w.goal_id)
        .eq("period", input.period)
        .maybeSingle();
      if (st?.approval_status === "aprovada") {
        return { error: "Há metas aprovadas neste mês. Reabra antes de redistribuir os pesos." };
      }
      const { error } = await supabase
        .from("individual_goal_entries")
        .update({ weight: Math.max(0, Number(w.weight) || 0) })
        .eq("goal_id", w.goal_id)
        .eq("period", input.period);
      if (error) return { error: error.message };
    }
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Reaproveita todas as metas de uma competência anterior no mês destino (não sobrescreve as já existentes). */
export async function copyPreviousMonthEntries(input: { owner_id: string; from_period: string; to_period: string }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!input.owner_id || !input.from_period || !input.to_period) return { error: "Parâmetros inválidos." };
    if (!(await canManageOwner(ctx, input.owner_id))) {
      return { error: "Você só pode reaproveitar metas dos seus colaboradores." };
    }
    const { data: goals } = await ctx.supabase
      .from("individual_goals")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("owner_id", input.owner_id);
    const ids = (goals ?? []).map((g) => g.id);
    if (ids.length === 0) return { error: "O colaborador não tem metas cadastradas." };

    const [{ data: prev }, { data: cur }] = await Promise.all([
      ctx.supabase
        .from("individual_goal_entries")
        .select("goal_id, target_value, partial_value, weight")
        .eq("period", input.from_period)
        .in("goal_id", ids),
      ctx.supabase
        .from("individual_goal_entries")
        .select("goal_id")
        .eq("period", input.to_period)
        .in("goal_id", ids),
    ]);
    if (!prev || prev.length === 0) return { error: "Não há metas no mês anterior para reaproveitar." };
    const existing = new Set((cur ?? []).map((c) => c.goal_id));
    const toInsert = prev
      .filter((p) => !existing.has(p.goal_id))
      .map((p) => ({
        tenant_id: ctx.tenantId,
        goal_id: p.goal_id,
        period: input.to_period,
        target_value: p.target_value,
        actual_value: null,
        weight: p.weight,
        partial_value: p.partial_value,
        created_by: ctx.userId,
      }));
    if (toInsert.length === 0) return { error: "Todas as metas do mês anterior já estão neste mês." };
    const { error } = await ctx.supabase.from("individual_goal_entries").insert(toInsert);
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- Fechamento mensal (aprovar / reprovar / fechar mês / reabrir) ----------

export async function approveGoalEntry(input: { goal_id: string; period: string }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!(await canManageOwner(ctx, await goalOwner(ctx, input.goal_id)))) {
      return { error: "Apenas o gestor do colaborador pode aprovar a meta." };
    }
    const { error } = await ctx.supabase
      .from("individual_goal_entries")
      .update({
        approval_status: "aprovada",
        approved_by: ctx.userId,
        approved_at: new Date().toISOString(),
        reproval_note: null,
      })
      .eq("goal_id", input.goal_id)
      .eq("period", input.period);
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function reproveGoalEntry(input: { goal_id: string; period: string; note: string }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const note = (input.note ?? "").trim();
    if (!note) return { error: "Informe o motivo da reprovação." };
    if (!(await canManageOwner(ctx, await goalOwner(ctx, input.goal_id)))) {
      return { error: "Apenas o gestor do colaborador pode reprovar a meta." };
    }
    const { error } = await ctx.supabase
      .from("individual_goal_entries")
      .update({
        approval_status: "reprovada",
        reproval_note: note,
        approved_by: null,
        approved_at: null,
      })
      .eq("goal_id", input.goal_id)
      .eq("period", input.period);
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Fecha o mês do colaborador: aprova todas as metas ainda "abertas" da competência. */
export async function approveMonth(input: { owner_id: string; period: string }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!(await canManageOwner(ctx, input.owner_id))) {
      return { error: "Apenas o gestor do colaborador pode fechar o mês." };
    }
    const { data: goals } = await ctx.supabase
      .from("individual_goals")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("owner_id", input.owner_id);
    const ids = (goals ?? []).map((g) => g.id);
    if (ids.length === 0) return { error: "O colaborador não tem metas cadastradas." };
    const { error } = await ctx.supabase
      .from("individual_goal_entries")
      .update({
        approval_status: "aprovada",
        approved_by: ctx.userId,
        approved_at: new Date().toISOString(),
        reproval_note: null,
      })
      .eq("period", input.period)
      .eq("approval_status", "aberta")
      .in("goal_id", ids);
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Reabre uma meta aprovada — exige adm/owner + confirmação da própria senha. */
export async function reopenGoalEntry(input: { goal_id: string; period: string; password: string }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!isAdminRole(ctx.role)) {
      return { error: "Apenas administrador ou owner pode reabrir uma meta aprovada." };
    }
    if (!(await verifyOwnPassword(input.password))) {
      return { error: "Senha inválida." };
    }
    // Competência fechada não abre uma meta por vez. Sem esta recusa, o cadeado
    // do mês seria contornável um lançamento de cada vez: reabrir a meta, mudar
    // o realizado e o valor pago do mês fechado mudava junto. Para mexer aqui,
    // reabre-se a competência inteira, que é o ato que fica no log.
    const { data: fechada } = await ctx.supabase
      .from("rv_period_locks")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("period", input.period)
      .maybeSingle();
    if (fechada) {
      return { error: "A competência está fechada. Reabra o mês em Metas antes de reabrir esta meta." };
    }
    const { error } = await ctx.supabase
      .from("individual_goal_entries")
      .update({
        approval_status: "aberta",
        approved_by: null,
        approved_at: null,
        reproval_note: null,
      })
      .eq("goal_id", input.goal_id)
      .eq("period", input.period)
      .eq("approval_status", "aprovada");
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- Evidência do atingimento ----------
//
// O anexo pende do LANÇAMENTO (a competência), não da meta: a prova é do
// resultado daquele mês. A permissão de quem sobe e de quem apaga é a mesma que
// já decide quem lança o realizado, e a RLS da tabela espelha isso sem reescrever
// a regra — inclusive a trava de não apagar depois de aprovada.

/** Localiza o lançamento e confere se quem chama pode mexer nele. */
async function entryParaEvidencia(
  ctx: Ctx,
  goalId: string,
  period: string,
): Promise<{ id: string; aprovada: boolean } | { error: string }> {
  const owner = await goalOwner(ctx, goalId);
  const canManage = await canManageOwner(ctx, owner);
  if (!(owner === ctx.userId || canManage)) {
    return { error: "Você não tem permissão para mexer nesta meta." };
  }
  const { data } = await ctx.supabase
    .from("individual_goal_entries")
    .select("id, approval_status")
    .eq("goal_id", goalId)
    .eq("period", period)
    .maybeSingle();
  if (!data) return { error: "Esta meta não está cadastrada nesta competência." };
  return { id: data.id, aprovada: data.approval_status === "aprovada" };
}

export async function uploadGoalEvidence(formData: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const goalId = String(formData.get("goal_id") ?? "");
    const period = String(formData.get("period") ?? "");
    if (!goalId || !period) return { error: "Lançamento inválido." };

    const alvo = await entryParaEvidencia(ctx, goalId, period);
    if ("error" in alvo) return alvo;
    if (alvo.aprovada) return { error: "Competência aprovada: a evidência não pode mais ser alterada." };

    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return { error: "Selecione ao menos um arquivo." };

    for (const file of files) {
      // recusa cedo e em português; o limite que vale mesmo é o do bucket
      const recusa = recusaDeUpload(file, TAMANHO_ANEXO, MIMES_ANEXO);
      if (recusa) return { error: recusa };
    }

    for (const file of files) {
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${ctx.tenantId}/${alvo.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
      const up = await ctx.supabase.storage
        .from(BUCKET_EVIDENCIA)
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (up.error) return { error: `Falha ao enviar "${file.name}": ${up.error.message}` };
      const { error } = await ctx.supabase.from("individual_goal_entry_attachments").insert({
        tenant_id: ctx.tenantId,
        entry_id: alvo.id,
        path,
        filename: file.name,
        size: file.size,
        content_type: file.type || null,
        uploaded_by: ctx.userId,
      });
      if (error) {
        // o arquivo já subiu: sem isso ele fica órfão no bucket, ocupando espaço
        // e sem nenhuma linha que o alcance
        await ctx.supabase.storage.from(BUCKET_EVIDENCIA).remove([path]);
        return { error: error.message };
      }
    }

    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteGoalEvidence(id: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!id) return { error: "Anexo inválido." };
    const { data: att } = await ctx.supabase
      .from("individual_goal_entry_attachments")
      .select("id, path, entry_id")
      .eq("id", id)
      .maybeSingle();
    if (!att) return { error: "Anexo não encontrado." };

    // a RLS já recusa apagar anexo de competência aprovada; aqui é só para a
    // mensagem sair em português em vez de "0 linhas afetadas"
    const { data: entry } = await ctx.supabase
      .from("individual_goal_entries")
      .select("approval_status, goal_id, actual_value")
      .eq("id", att.entry_id)
      .maybeSingle();
    if (entry?.approval_status === "aprovada") {
      return { error: "Competência aprovada: a evidência não pode mais ser removida." };
    }
    if (entry?.goal_id) {
      const owner = await goalOwner(ctx, entry.goal_id);
      const canManage = await canManageOwner(ctx, owner);
      if (!(owner === ctx.userId || canManage)) return { error: "Você não tem permissão para remover esta evidência." };

      // NÃO DEIXA O REALIZADO FICAR ÓRFÃO DE EVIDÊNCIA.
      //
      // Exigir o anexo só na hora de gravar deixava uma porta aberta: salvar com
      // evidência e apagar o arquivo em seguida, ficando com o número comprovado
      // por nada. Quem precisa trocar o arquivo sobe o novo primeiro e aí remove
      // o antigo, que já não é o último.
      const { data: meta } = await ctx.supabase
        .from("individual_goals")
        .select("evidence_required")
        .eq("id", entry.goal_id)
        .maybeSingle();
      if (meta?.evidence_required && entry.actual_value != null) {
        const { count } = await ctx.supabase
          .from("individual_goal_entry_attachments")
          .select("id", { count: "exact", head: true })
          .eq("entry_id", att.entry_id);
        if ((count ?? 0) <= 1) {
          return { error: "Esta meta exige evidência e já tem realizado lançado. Anexe o arquivo novo antes de remover o atual." };
        }
      }
    }

    const { error } = await ctx.supabase.from("individual_goal_entry_attachments").delete().eq("id", id);
    if (error) return { error: error.message };
    const rm = await ctx.supabase.storage.from(BUCKET_EVIDENCIA).remove([att.path]);
    if (rm.error) console.error("[evidencia] limpeza do arquivo:", rm.error.message);

    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Link temporário para baixar. O bucket é privado: sem isso não há como abrir. */
export async function goalEvidenceUrl(path: string): Promise<{ url?: string; error?: string }> {
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.storage.from(BUCKET_EVIDENCIA).createSignedUrl(path, 60 * 10);
    if (error) return { error: error.message };
    return { url: data?.signedUrl };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
