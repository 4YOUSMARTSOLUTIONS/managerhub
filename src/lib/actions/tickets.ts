"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { createServiceClient } from "@/lib/supabase/admin";
import { PRIORITY } from "@/lib/constants";
import type { ActionState } from "./types";
import type { Database, Enums } from "@/types/database";

type TicketUpdate = Database["public"]["Tables"]["tickets"]["Update"];
type Ctx = Awaited<ReturnType<typeof actionContext>>;

/** Quem pode tratar chamados: owner/admin ou usuário designado gestor de chamados. */
async function canTreatTickets(ctx: Ctx): Promise<boolean> {
  if (ctx.role === "owner" || ctx.role === "admin") return true;
  const { data } = await ctx.supabase
    .from("memberships")
    .select("is_ticket_manager")
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  return !!data?.is_ticket_manager;
}

const BUCKET = "ticket-attachments";
const RP = "/configuracoes";

type SlaUnit = Enums<"ticket_sla_unit">;

/** Soma o SLA a uma data e devolve ISO. "dias_uteis" pula sábados/domingos. */
function computeDueDate(fromISO: string, value: number, unit: SlaUnit): string {
  const d = new Date(fromISO);
  const n = Math.max(0, Math.round(Number(value) || 0));
  if (unit === "horas") {
    d.setHours(d.getHours() + n);
  } else if (unit === "dias_corridos") {
    d.setDate(d.getDate() + n);
  } else {
    let remaining = n;
    while (remaining > 0) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) remaining -= 1;
    }
  }
  return d.toISOString();
}

/** Busca o SLA de (categoria, prioridade) e calcula o prazo a partir de `fromISO`. */
async function dueFromSla(
  supabase: Awaited<ReturnType<typeof actionContext>>["supabase"],
  categoryId: string | null,
  priority: Enums<"priority_level">,
  fromISO: string,
): Promise<string | null> {
  if (!categoryId) return null;
  const { data: sla } = await supabase
    .from("ticket_slas")
    .select("sla_value, sla_unit")
    .eq("category_id", categoryId)
    .eq("priority", priority)
    .maybeSingle();
  return sla ? computeDueDate(fromISO, sla.sla_value, sla.sla_unit) : null;
}

export async function createTicket(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await actionContext();

    const title = String(formData.get("title") ?? "").trim();
    if (!title) return { error: "Informe o título do chamado." };

    const sector_id = String(formData.get("sector_id") ?? "") || null;
    const category_id = String(formData.get("category_id") ?? "") || null;
    const unit_id = String(formData.get("unit_id") ?? "") || null;
    const priority = String(formData.get("priority") ?? "medium") as Enums<"priority_level">;

    // prazo derivado do SLA da categoria + prioridade (a partir de agora)
    const due_date = await dueFromSla(supabase, category_id, priority, new Date().toISOString());

    const { data: ticket, error } = await supabase
      .from("tickets")
      .insert({
        tenant_id: tenantId,
        title,
        description: String(formData.get("description") ?? "").trim() || null,
        sector_id,
        category_id,
        unit_id,
        priority,
        requested_priority: priority,
        due_date,
        requester_id: userId,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    const ticketId = ticket.id;

    // anexos — somente imagens
    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${tenantId}/${ticketId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (up.error) continue;
      await supabase.from("ticket_attachments").insert({
        tenant_id: tenantId,
        ticket_id: ticketId,
        path,
        filename: file.name,
        size: file.size,
        content_type: file.type || null,
        uploaded_by: userId,
      });
    }

    revalidatePath("/chamados");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type TriageInput = {
  ticket_id: string;
  status?: Enums<"ticket_status">;
  priority?: Enums<"priority_level">;
  sector_id?: string | null;
  category_id?: string | null;
  assignee_id?: string | null;
};

/** Tratamento do chamado: muda status/prioridade/categoria/responsável; recalcula prazo e notifica. */
export async function updateTicketTriage(input: TriageInput): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { supabase, tenantId, userId } = ctx;
    if (!(await canTreatTickets(ctx))) {
      return { error: "Apenas o gestor de chamados (ou owner/admin) pode tratar chamados." };
    }

    const { data: cur, error: e0 } = await supabase
      .from("tickets")
      .select("id, created_at, priority, category_id, requester_id, code")
      .eq("id", input.ticket_id)
      .maybeSingle();
    if (e0) return { error: e0.message };
    if (!cur) return { error: "Chamado não encontrado." };

    const newPriority = input.priority ?? cur.priority;
    const newCategory = input.category_id !== undefined ? (input.category_id || null) : cur.category_id;
    const priorityChanged = newPriority !== cur.priority;
    const categoryChanged = newCategory !== cur.category_id;

    const patch: TicketUpdate = {};
    if (input.status !== undefined) {
      patch.status = input.status;
      const done = input.status === "resolved" || input.status === "closed";
      patch.resolved_at = done ? new Date().toISOString() : null;
    }
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.sector_id !== undefined) patch.sector_id = input.sector_id || null;
    if (input.category_id !== undefined) patch.category_id = input.category_id || null;
    if (input.assignee_id !== undefined) patch.assignee_id = input.assignee_id || null;

    // prioridade ou categoria mudou → recalcula prazo (a partir da abertura)
    if (priorityChanged || categoryChanged) {
      patch.due_date = await dueFromSla(supabase, newCategory, newPriority, cur.created_at);
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from("tickets").update(patch).eq("id", input.ticket_id);
      if (error) return { error: error.message };
    }

    // comunica o solicitante sobre a mudança de prioridade/categoria
    if ((priorityChanged || categoryChanged) && cur.requester_id && cur.requester_id !== userId) {
      const body = priorityChanged
        ? `A prioridade do seu chamado foi ajustada para ${PRIORITY[newPriority]}.`
        : "A categoria do seu chamado foi atualizada.";
      await supabase.rpc("notify_users", {
        p_tenant: tenantId,
        p_users: [cur.requester_id],
        p_type: "ticket",
        p_title: `Chamado ${cur.code ?? ""} atualizado`.trim(),
        p_body: body,
        p_demanda: null,
      });
    }

    revalidatePath("/chamados");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function getTicketAttachmentUrl(path: string): Promise<string | null> {
  const { supabase } = await actionContext();
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}

// ---------- Avaliação (NPS) do chamado — somente o solicitante ----------
export async function rateTicket(input: { ticket_id: string; score: number; comment?: string }): Promise<ActionState> {
  try {
    const { supabase, userId } = await actionContext();
    const score = Math.round(Number(input.score));
    if (!input.ticket_id) return { error: "Chamado inválido." };
    if (!Number.isInteger(score) || score < 0 || score > 10) return { error: "Informe uma nota de 0 a 10." };

    const { data: t, error: e0 } = await supabase
      .from("tickets")
      .select("requester_id, status")
      .eq("id", input.ticket_id)
      .maybeSingle();
    if (e0) return { error: e0.message };
    if (!t) return { error: "Chamado não encontrado." };
    if (t.requester_id !== userId) return { error: "Apenas o solicitante pode avaliar o chamado." };
    if (t.status !== "resolved" && t.status !== "closed") return { error: "Avalie o chamado apenas após ser resolvido." };

    const { error } = await supabase
      .from("tickets")
      .update({ nps_score: score, nps_comment: (input.comment ?? "").trim() || null, rated_at: new Date().toISOString() })
      .eq("id", input.ticket_id);
    if (error) return { error: error.message };

    revalidatePath("/chamados");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- Comentários do chamado ----------
export type TicketComment = { id: string; body: string; authorName: string | null; createdAt: string };

export async function getTicketComments(ticketId: string): Promise<TicketComment[]> {
  const { supabase } = await actionContext();
  const { data } = await supabase
    .from("ticket_comments")
    .select("id, body, created_at, author:profiles!author_id(full_name)")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  return (data ?? []).map((c) => ({
    id: c.id,
    body: c.body,
    authorName: (c.author as unknown as { full_name: string | null } | null)?.full_name ?? null,
    createdAt: c.created_at,
  }));
}

export async function addTicketComment(ticketId: string, body: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { supabase, userId } = ctx;
    const text = body.trim();
    if (!text) return { error: "Escreva um comentário." };

    const { data: t, error: e0 } = await supabase.from("tickets").select("requester_id").eq("id", ticketId).maybeSingle();
    if (e0) return { error: e0.message };
    if (!t) return { error: "Chamado não encontrado." };

    const allowed = userId === t.requester_id || (await canTreatTickets(ctx));
    if (!allowed) return { error: "Apenas o gestor de chamados e o solicitante podem comentar." };

    const { error } = await supabase.from("ticket_comments").insert({ ticket_id: ticketId, author_id: userId, body: text });
    if (error) return { error: error.message };

    revalidatePath("/chamados");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- Designação de gestores de chamado (owner/admin) ----------
export async function setTicketManager(input: { user_id: string; value: boolean }): Promise<ActionState> {
  try {
    const { tenantId, role } = await actionContext();
    if (role !== "owner" && role !== "admin") return { error: "Apenas owner/admin podem designar gestores de chamado." };
    if (!input.user_id) return { error: "Usuário inválido." };
    // service role: alterar memberships com segurança (checagem de papel feita acima)
    const admin = createServiceClient();
    const { error } = await admin
      .from("memberships")
      .update({ is_ticket_manager: input.value })
      .eq("tenant_id", tenantId)
      .eq("user_id", input.user_id);
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    revalidatePath("/chamados");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setTicketStatus(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as Enums<"ticket_status">;
  const done = status === "resolved" || status === "closed";
  await supabase
    .from("tickets")
    .update({ status, resolved_at: done ? new Date().toISOString() : null })
    .eq("id", id);
  revalidatePath("/chamados");
  revalidatePath("/dashboard");
}

export async function deleteTicket(formData: FormData): Promise<ActionState> {
  const { supabase } = await actionContext();
  const { error } = await supabase.from("tickets").delete().eq("id", String(formData.get("id")));
  if (error) return { error: error.message };
  revalidatePath("/chamados");
  revalidatePath("/dashboard");
  return { ok: true };
}

// ---------- Configuração: Setores ----------
export async function createTicketSector(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("ticket_sectors").insert({ tenant_id: tenantId, name });
  revalidatePath(RP);
  revalidatePath("/chamados");
}
export async function deleteTicketSector(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("ticket_sectors").delete().eq("id", String(formData.get("id")));
  revalidatePath(RP);
  revalidatePath("/chamados");
}

// ---------- Configuração: Categorias ----------
export async function createTicketCategory(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const name = String(formData.get("name") ?? "").trim();
  const sector_id = String(formData.get("sector_id") ?? "");
  if (!name || !sector_id) return;
  await supabase.from("ticket_categories").insert({ tenant_id: tenantId, sector_id, name });
  revalidatePath(RP);
  revalidatePath("/chamados");
}
export async function deleteTicketCategory(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("ticket_categories").delete().eq("id", String(formData.get("id")));
  revalidatePath(RP);
  revalidatePath("/chamados");
}

// ---------- Configuração: SLA (matriz categoria × prioridade) ----------
export async function setTicketSla(input: {
  category_id: string;
  priority: Enums<"priority_level">;
  sla_value: number;
  sla_unit: Enums<"ticket_sla_unit">;
}): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    if (!input.category_id) return { error: "Categoria inválida." };
    const value = Math.max(0, Math.round(Number(input.sla_value) || 0));
    const { error } = await supabase
      .from("ticket_slas")
      .upsert(
        { tenant_id: tenantId, category_id: input.category_id, priority: input.priority, sla_value: value, sla_unit: input.sla_unit },
        { onConflict: "category_id,priority" },
      );
    if (error) return { error: error.message };
    revalidatePath(RP);
    revalidatePath("/chamados");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
