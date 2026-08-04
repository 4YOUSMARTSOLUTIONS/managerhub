"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { createServiceClient } from "@/lib/supabase/admin";
import { getPlatformOpenAI } from "@/lib/platform-integrations";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { recusaDeUpload, TAMANHO_ANEXO, MIMES_ANEXO } from "@/lib/uploads";
import { souGestorDe } from "@/lib/team";

const BUCKET = "feedback-attachments";

function isAdminRole(role: Enums<"member_role">) {
  return role === "owner" || role === "admin";
}

type Ctx = { supabase: SupabaseClient<Database>; tenantId: string; userId: string; role: Enums<"member_role"> };

/** true se o usuário atual pode registrar/editar feedback do colaborador (admin ou gestor direto). */
async function canManageOwner(ctx: Ctx, ownerId: string): Promise<boolean> {
  if (isAdminRole(ctx.role)) return true;
  if (!ownerId || ownerId === ctx.userId) return false;
  return souGestorDe(ctx.supabase, ownerId, ctx.tenantId);
}

type FeedbackPayload = {
  id?: string;
  subject_user_id: string;
  feedback_date: string;
  type: Enums<"feedback_type">;
  channel?: Enums<"feedback_channel"> | null;
  title?: string | null;
  situation?: string | null;
  behavior?: string | null;
  impact?: string | null;
  next_steps?: string | null;
  notes?: string | null;
  visibility: Enums<"feedback_visibility">;
  competency_ids?: string[];
};

const clean = (v: string | null | undefined) => (v ?? "").trim() || null;

async function uploadFiles(ctx: Ctx, feedbackId: string, files: File[]) {
  for (const file of files) {
    if (!(file instanceof File) || file.size === 0) continue;
    if (recusaDeUpload(file, TAMANHO_ANEXO, MIMES_ANEXO)) continue;
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${ctx.tenantId}/${feedbackId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
    const up = await ctx.supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (up.error) continue;
    await ctx.supabase.from("feedback_attachments").insert({
      tenant_id: ctx.tenantId,
      feedback_id: feedbackId,
      path,
      filename: file.name,
      size: file.size,
      content_type: file.type || null,
      uploaded_by: ctx.userId,
    });
  }
}

export async function createFeedback(formData: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const raw = String(formData.get("payload") ?? "");
    if (!raw) return { error: "Dados inválidos." };
    const p = JSON.parse(raw) as FeedbackPayload;

    if (!p.subject_user_id) return { error: "Selecione o colaborador." };
    if (!p.feedback_date) return { error: "Informe a data do feedback." };
    if (!(await canManageOwner(ctx, p.subject_user_id))) {
      return { error: "Você só pode registrar feedback para os seus colaboradores." };
    }
    const hasContent = [p.situation, p.behavior, p.impact, p.next_steps, p.notes].some((x) => (x ?? "").trim());
    if (!hasContent) return { error: "Preencha ao menos um campo do feedback (situação, comportamento, impacto ou observações)." };

    const { data: fb, error } = await ctx.supabase
      .from("feedbacks")
      .insert({
        tenant_id: ctx.tenantId,
        subject_user_id: p.subject_user_id,
        author_id: ctx.userId,
        feedback_date: p.feedback_date,
        type: p.type,
        channel: p.channel || null,
        title: clean(p.title),
        situation: clean(p.situation),
        behavior: clean(p.behavior),
        impact: clean(p.impact),
        next_steps: clean(p.next_steps),
        notes: clean(p.notes),
        visibility: p.visibility,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };

    const compIds = [...new Set(p.competency_ids ?? [])];
    if (compIds.length) {
      await ctx.supabase.from("feedback_competency_links").insert(
        compIds.map((competency_id) => ({ feedback_id: fb.id, competency_id, tenant_id: ctx.tenantId })),
      );
    }
    await uploadFiles(ctx, fb.id, formData.getAll("files") as File[]);

    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updateFeedback(formData: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const raw = String(formData.get("payload") ?? "");
    if (!raw) return { error: "Dados inválidos." };
    const p = JSON.parse(raw) as FeedbackPayload;
    if (!p.id) return { error: "Feedback inválido." };

    const hasContent = [p.situation, p.behavior, p.impact, p.next_steps, p.notes].some((x) => (x ?? "").trim());
    if (!hasContent) return { error: "Preencha ao menos um campo do feedback." };

    const { error } = await ctx.supabase
      .from("feedbacks")
      .update({
        feedback_date: p.feedback_date,
        type: p.type,
        channel: p.channel || null,
        title: clean(p.title),
        situation: clean(p.situation),
        behavior: clean(p.behavior),
        impact: clean(p.impact),
        next_steps: clean(p.next_steps),
        notes: clean(p.notes),
        visibility: p.visibility,
        updated_at: new Date().toISOString(),
      })
      .eq("id", p.id);
    if (error) return { error: error.message };

    // substitui os vínculos de competências
    await ctx.supabase.from("feedback_competency_links").delete().eq("feedback_id", p.id);
    const compIds = [...new Set(p.competency_ids ?? [])];
    if (compIds.length) {
      await ctx.supabase.from("feedback_competency_links").insert(
        compIds.map((competency_id) => ({ feedback_id: p.id!, competency_id, tenant_id: ctx.tenantId })),
      );
    }
    await uploadFiles(ctx, p.id, formData.getAll("files") as File[]);

    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteFeedback(id: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { data: atts } = await ctx.supabase.from("feedback_attachments").select("path").eq("feedback_id", id);
    const paths = (atts ?? []).map((a) => a.path);
    if (paths.length) {
      const rm = await ctx.supabase.storage.from(BUCKET).remove(paths);
      if (rm.error) console.error("feedback storage cleanup:", rm.error.message);
    }
    const { error } = await ctx.supabase.from("feedbacks").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteFeedbackAttachment(input: { id: string; path: string }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const rm = await ctx.supabase.storage.from(BUCKET).remove([input.path]);
    if (rm.error) console.error("feedback attachment cleanup:", rm.error.message);
    const { error } = await ctx.supabase.from("feedback_attachments").delete().eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** O colaborador dá ciência de um feedback compartilhado (via service client, checando a autoria). */
export async function acknowledgeFeedback(input: { feedback_id: string }): Promise<ActionState> {
  try {
    const { userId, tenantId } = await actionContext();
    const admin = createServiceClient();
    const { data: fb } = await admin
      .from("feedbacks")
      .select("id, subject_user_id, visibility, tenant_id, acknowledged_at, applied_at")
      .eq("id", input.feedback_id)
      .maybeSingle();
    if (!fb || fb.tenant_id !== tenantId) return { error: "Feedback não encontrado." };
    if (fb.subject_user_id !== userId) return { error: "Somente o colaborador pode dar ciência." };
    if (fb.visibility !== "compartilhado" || !fb.applied_at) return { error: "Feedback indisponível." };
    if (fb.acknowledged_at) return { ok: true };
    const { error } = await admin.from("feedbacks").update({ acknowledged_at: new Date().toISOString() }).eq("id", input.feedback_id);
    if (error) return { error: error.message };
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function getFeedbackAttachmentUrl(path: string): Promise<string | null> {
  try {
    const { supabase } = await actionContext();
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

// ---------- estado "aplicado" (conversado com o colaborador) ----------
export async function setFeedbackApplied(input: { id: string; applied: boolean }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { error } = await ctx.supabase
      .from("feedbacks")
      .update({ applied_at: input.applied ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- sessões de feedback (1:1) ----------
type SessionPayload = {
  id?: string;
  subject_user_id: string;
  session_date: string;
  reference_month?: string | null;
  title?: string | null;
  highlights?: string | null;
  development?: string | null;
  action_plan?: string | null;
  overall?: string | null;
  visibility: Enums<"feedback_visibility">;
  item_feedback_ids?: string[];
};

export async function createFeedbackSession(input: SessionPayload): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!input.subject_user_id) return { error: "Selecione o colaborador." };
    if (!input.session_date) return { error: "Informe a data da sessão." };
    if (!(await canManageOwner(ctx, input.subject_user_id))) {
      return { error: "Você só pode registrar sessões para os seus colaboradores." };
    }
    if (![input.highlights, input.development, input.action_plan, input.overall].some((x) => (x ?? "").trim())) {
      return { error: "Preencha ao menos um campo da sessão." };
    }
    const { data: s, error } = await ctx.supabase
      .from("feedback_sessions")
      .insert({
        tenant_id: ctx.tenantId,
        subject_user_id: input.subject_user_id,
        author_id: ctx.userId,
        session_date: input.session_date,
        reference_month: input.reference_month || null,
        title: clean(input.title),
        highlights: clean(input.highlights),
        development: clean(input.development),
        action_plan: clean(input.action_plan),
        overall: clean(input.overall),
        visibility: input.visibility,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    const items = [...new Set(input.item_feedback_ids ?? [])];
    if (items.length) {
      await ctx.supabase.from("feedback_session_items").insert(
        items.map((feedback_id) => ({ session_id: s.id, feedback_id, tenant_id: ctx.tenantId })),
      );
    }
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updateFeedbackSession(input: SessionPayload): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!input.id) return { error: "Sessão inválida." };
    if (![input.highlights, input.development, input.action_plan, input.overall].some((x) => (x ?? "").trim())) {
      return { error: "Preencha ao menos um campo da sessão." };
    }
    const { error } = await ctx.supabase
      .from("feedback_sessions")
      .update({
        session_date: input.session_date,
        reference_month: input.reference_month || null,
        title: clean(input.title),
        highlights: clean(input.highlights),
        development: clean(input.development),
        action_plan: clean(input.action_plan),
        overall: clean(input.overall),
        visibility: input.visibility,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id);
    if (error) return { error: error.message };
    await ctx.supabase.from("feedback_session_items").delete().eq("session_id", input.id);
    const items = [...new Set(input.item_feedback_ids ?? [])];
    if (items.length) {
      await ctx.supabase.from("feedback_session_items").insert(
        items.map((feedback_id) => ({ session_id: input.id!, feedback_id, tenant_id: ctx.tenantId })),
      );
    }
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteFeedbackSession(id: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { error } = await ctx.supabase.from("feedback_sessions").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setFeedbackSessionApplied(input: { id: string; applied: boolean }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const now = new Date().toISOString();
    const { error } = await ctx.supabase
      .from("feedback_sessions")
      .update({ applied_at: input.applied ? now : null, updated_at: now })
      .eq("id", input.id);
    if (error) return { error: error.message };

    // ao aplicar a sessão, aplica também os feedbacks pontuais referenciados que ainda não estavam
    // aplicados (a permissão de aplicar a própria sessão já foi validada pela policy acima).
    if (input.applied) {
      const { data: items } = await ctx.supabase
        .from("feedback_session_items").select("feedback_id").eq("session_id", input.id);
      const ids = (items ?? []).map((i) => i.feedback_id);
      if (ids.length) {
        const admin = createServiceClient();
        const { error: e2 } = await admin
          .from("feedbacks")
          .update({ applied_at: now, updated_at: now })
          .eq("tenant_id", ctx.tenantId)
          .in("id", ids)
          .is("applied_at", null);
        if (e2) console.error("cascata aplicar pontuais:", e2.message);
      }
    }

    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function acknowledgeFeedbackSession(input: { session_id: string }): Promise<ActionState> {
  try {
    const { userId, tenantId } = await actionContext();
    const admin = createServiceClient();
    const { data: s } = await admin
      .from("feedback_sessions")
      .select("id, subject_user_id, visibility, tenant_id, acknowledged_at, applied_at")
      .eq("id", input.session_id)
      .maybeSingle();
    if (!s || s.tenant_id !== tenantId) return { error: "Sessão não encontrada." };
    if (s.subject_user_id !== userId) return { error: "Somente o colaborador pode dar ciência." };
    if (s.visibility !== "compartilhado" || !s.applied_at) return { error: "Sessão indisponível." };
    if (s.acknowledged_at) return { ok: true };
    const { error } = await admin.from("feedback_sessions").update({ acknowledged_at: new Date().toISOString() }).eq("id", input.session_id);
    if (error) return { error: error.message };
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- rascunho de sessão por IA ----------
export type FeedbackSessionDraft = { ok: true; highlights: string; development: string; action_plan: string } | { ok?: false; error: string };

export async function generateFeedbackSessionAI(input: { subject_user_id: string; from: string; to: string }): Promise<FeedbackSessionDraft> {
  try {
    const ctx = await actionContext();
    if (!(await canManageOwner(ctx, input.subject_user_id))) {
      return { error: "Você só pode gerar sessões para os seus colaboradores." };
    }
    // chave/modelo centralizados na plataforma (nunca voltam ao cliente)
    const { apiKey, model } = await getPlatformOpenAI();
    if (!apiKey) return { error: "IA não configurada. Peça ao proprietário do sistema para configurar a chave da OpenAI." };

    // feedbacks pontuais do período (RLS aplica: só o que o gestor pode ver)
    const { data: fbs } = await ctx.supabase
      .from("feedbacks")
      .select("feedback_date, type, title, situation, behavior, impact, next_steps, notes")
      .eq("subject_user_id", input.subject_user_id)
      .gte("feedback_date", input.from)
      .lte("feedback_date", input.to)
      .order("feedback_date");
    if (!fbs || fbs.length === 0) {
      return { error: "Não há feedbacks pontuais desse colaborador no período para consolidar." };
    }

    const typeLabel: Record<string, string> = { reconhecimento: "Reconhecimento", construtivo: "Construtivo", neutro: "Neutro" };
    const linhas = fbs.map((f) => {
      const partes = [
        `Data: ${f.feedback_date}`, `Tipo: ${typeLabel[f.type] ?? f.type}`,
        f.title ? `Título: ${f.title}` : null,
        f.situation ? `Situação: ${f.situation}` : null,
        f.behavior ? `Comportamento: ${f.behavior}` : null,
        f.impact ? `Impacto: ${f.impact}` : null,
        f.next_steps ? `Próximos passos: ${f.next_steps}` : null,
        f.notes ? `Observações: ${f.notes}` : null,
      ].filter(Boolean);
      return "- " + partes.join(" | ");
    }).join("\n");

    const system =
      "Você é um assistente de RH que consolida feedbacks pontuais de um colaborador em um resumo para uma conversa 1:1, em português do Brasil. " +
      "Produza um JSON com exatamente três chaves de texto: \"destaques\" (pontos fortes/reconhecimentos), " +
      "\"desenvolvimento\" (pontos a desenvolver, a partir dos feedbacks construtivos) e \"plano\" (sugestão de combinados/próximos passos). " +
      "Use frases claras e tópicos com \"- \" quando fizer sentido. Seja fiel aos feedbacks: NÃO invente fatos. Não inclua nada além do JSON.";
    const user = `Feedbacks do período (${input.from} a ${input.to}):\n${linhas}`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }], response_format: { type: "json_object" } }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      let msg = `Falha na chamada à OpenAI (HTTP ${resp.status}).`;
      try { const j = JSON.parse(body); if (j?.error?.message) msg = `OpenAI: ${j.error.message}`; } catch { /* noop */ }
      return { error: msg };
    }
    const data = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    const cleaned = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    let parsed: { destaques?: unknown; desenvolvimento?: unknown; plano?: unknown } = {};
    try { parsed = JSON.parse(cleaned); } catch { return { error: "A IA devolveu um formato inesperado. Tente novamente." }; }
    const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : Array.isArray(v) ? v.map(String).join("\n") : String(v));
    return { ok: true, highlights: str(parsed.destaques), development: str(parsed.desenvolvimento), action_plan: str(parsed.plano) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- periodicidade por setor + função (owner/admin) ----------
export async function upsertCadenceRule(input: { department_id: string; position_id: string; cadence_days: number }): Promise<ActionState> {
  try {
    const { supabase, tenantId, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem definir a periodicidade." };
    if (!input.department_id || !input.position_id) return { error: "Selecione o setor e a função." };
    const days = Math.max(0, Math.round(Number(input.cadence_days) || 0));
    const { error } = await supabase.from("feedback_cadence_rules").upsert(
      { tenant_id: tenantId, department_id: input.department_id, position_id: input.position_id, cadence_days: days, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,department_id,position_id" },
    );
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteCadenceRule(id: string): Promise<ActionState> {
  try {
    const { supabase, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem definir a periodicidade." };
    const { error } = await supabase.from("feedback_cadence_rules").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- catálogo de competências (owner/admin) ----------
export async function createFeedbackCompetency(input: { name: string; sort?: number }): Promise<ActionState> {
  try {
    const { supabase, tenantId, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem gerenciar competências." };
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome da competência." };
    const { error } = await supabase.from("feedback_competencies").insert({ tenant_id: tenantId, name, sort: input.sort ?? 0 });
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updateFeedbackCompetency(input: { id: string; name: string; active?: boolean; sort?: number }): Promise<ActionState> {
  try {
    const { supabase, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem gerenciar competências." };
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome da competência." };
    const patch: { name: string; active?: boolean; sort?: number } = { name };
    if (input.active !== undefined) patch.active = input.active;
    if (input.sort !== undefined) patch.sort = input.sort;
    const { error } = await supabase.from("feedback_competencies").update(patch).eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteFeedbackCompetency(id: string): Promise<ActionState> {
  try {
    const { supabase, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem gerenciar competências." };
    // já marcada em algum feedback? preserva o histórico: desativa em vez de excluir
    const { count } = await supabase.from("feedback_competency_links").select("*", { count: "exact", head: true }).eq("competency_id", id);
    if ((count ?? 0) > 0) {
      await supabase.from("feedback_competencies").update({ active: false }).eq("id", id);
      revalidatePath("/configuracoes");
      revalidatePath("/feedbacks");
      return { ok: true };
    }
    const { error } = await supabase.from("feedback_competencies").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// wrappers p/ o <RegistryList> (form actions void) usado em Configurações
export async function addFeedbackCompetencyForm(formData: FormData): Promise<void> {
  await createFeedbackCompetency({ name: String(formData.get("name") ?? "") });
}
export async function removeFeedbackCompetencyForm(formData: FormData): Promise<void> {
  await deleteFeedbackCompetency(String(formData.get("id") ?? ""));
}
export async function toggleFeedbackCompetencyForm(formData: FormData): Promise<void> {
  const { supabase, role } = await actionContext();
  if (!isAdminRole(role)) return;
  const active = String(formData.get("active") ?? "") === "1";
  await supabase.from("feedback_competencies").update({ active }).eq("id", String(formData.get("id") ?? ""));
  revalidatePath("/configuracoes");
  revalidatePath("/feedbacks");
}
