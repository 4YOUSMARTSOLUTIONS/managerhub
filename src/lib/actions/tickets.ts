"use server";

import { revalidatePath } from "next/cache";
import { actionContext, adminActionContext } from "./context";
import { verifyOwnPassword } from "./verify-password";
import { createServiceClient } from "@/lib/supabase/admin";
import { isCatalogInUse, wantsActive } from "@/lib/catalogGuard";
import { PRIORITY } from "@/lib/constants";
import type { ActionState } from "./types";
import type { Database, Enums } from "@/types/database";
import { recusaDeUpload, TAMANHO_ANEXO, MIMES_ANEXO } from "@/lib/uploads";

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

/** Setores que o usuário atual gerencia (escopo de chamados). Owner/admin não são restritos. */
async function managedSectorIds(ctx: Ctx): Promise<string[]> {
  const { data } = await ctx.supabase
    .from("ticket_manager_sectors")
    .select("sector_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId);
  return (data ?? []).map((r) => r.sector_id);
}

/**
 * Quem pode mexer no chamado: owner/admin, o solicitante, ou o gestor do setor.
 * Mesma regra da RLS (policy tickets_update) — aqui só para a recusa ter mensagem.
 */
async function podeTratarChamado(ctx: Ctx, ticketId: string): Promise<boolean> {
  if (ctx.role === "owner" || ctx.role === "admin") return true;
  const { data: t } = await ctx.supabase
    .from("tickets").select("requester_id, sector_id").eq("id", ticketId).maybeSingle();
  if (!t) return false;
  if (t.requester_id === ctx.userId) return true;
  return Boolean(t.sector_id && (await managedSectorIds(ctx)).includes(t.sector_id));
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

type SlaMode = "priority" | "category";

/** Lê o modo de SLA da empresa (por prioridade ou somente por categoria). */
async function getSlaMode(
  supabase: Awaited<ReturnType<typeof actionContext>>["supabase"],
  tenantId: string,
): Promise<SlaMode> {
  const { data } = await supabase.from("tenants").select("ticket_sla_mode").eq("id", tenantId).maybeSingle();
  return data?.ticket_sla_mode === "category" ? "category" : "priority";
}

/**
 * Busca o SLA da categoria e calcula o prazo a partir de `fromISO`.
 * Modo "priority": SLA por categoria + prioridade. Modo "category": SLA só por categoria (priority null).
 */
async function dueFromSla(
  supabase: Awaited<ReturnType<typeof actionContext>>["supabase"],
  categoryId: string | null,
  priority: Enums<"priority_level">,
  fromISO: string,
  mode: SlaMode,
): Promise<string | null> {
  if (!categoryId) return null;
  let q = supabase.from("ticket_slas").select("sla_value, sla_unit").eq("category_id", categoryId);
  q = mode === "category" ? q.is("priority", null) : q.eq("priority", priority);
  const { data: sla } = await q.maybeSingle();
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

    // prazo derivado do SLA (a partir de agora); modo define se usa a prioridade
    const mode = await getSlaMode(supabase, tenantId);
    const due_date = await dueFromSla(supabase, category_id, priority, new Date().toISOString(), mode);

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
      if (recusaDeUpload(file, TAMANHO_ANEXO, MIMES_ANEXO)) continue;
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

    const { data: cur, error: e0 } = await supabase
      .from("tickets")
      .select("id, created_at, priority, category_id, sector_id, requester_id, code")
      .eq("id", input.ticket_id)
      .maybeSingle();
    if (e0) return { error: e0.message };
    if (!cur) return { error: "Chamado não encontrado." };

    // escopo: owner/admin tratam tudo; gestor de chamados só os setores que gerencia
    const fullAccess = ctx.role === "owner" || ctx.role === "admin";
    if (!fullAccess) {
      const managed = await managedSectorIds(ctx);
      if (managed.length === 0) return { error: "Apenas o gestor de chamados (ou owner/admin) pode tratar chamados." };
      if (!cur.sector_id || !managed.includes(cur.sector_id)) {
        return { error: "Você só pode tratar chamados dos setores que gerencia." };
      }
      // não pode mover o chamado para um setor fora do seu escopo
      const newSector = input.sector_id !== undefined ? (input.sector_id || null) : cur.sector_id;
      if (newSector && !managed.includes(newSector)) {
        return { error: "Você só pode atribuir o chamado a um setor que gerencia." };
      }
    }

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
      const mode = await getSlaMode(supabase, tenantId);
      patch.due_date = await dueFromSla(supabase, newCategory, newPriority, cur.created_at, mode);
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

// ---------- Conclusão com "de acordo" do solicitante ----------
/** Gestor conclui o chamado: fica "aguardando de acordo" do solicitante (não encerra ainda). */
export async function requestTicketConclusion(ticketId: string): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await actionContext();
    const { error } = await supabase.rpc("ticket_request_conclusion", { p_ticket: ticketId });
    if (error) return { error: error.message };

    const { data: t } = await supabase
      .from("tickets")
      .select("requester_id, code, title")
      .eq("id", ticketId)
      .maybeSingle();
    if (t?.requester_id && t.requester_id !== userId) {
      await supabase.rpc("notify_users", {
        p_tenant: tenantId,
        p_users: [t.requester_id],
        p_type: "ticket",
        p_title: `Chamado ${t.code ?? ""} aguardando seu de acordo`.trim(),
        p_body: `O atendimento de "${t.title}" foi concluído. Confirme se está de acordo para encerrar o chamado.`,
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

/** Solicitante decide: aprova (→ Resolvido) ou recusa (→ Em atendimento + comentário). */
export async function decideTicketConclusion(ticketId: string, approve: boolean, note: string): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await actionContext();
    const { error } = await supabase.rpc("ticket_decide_conclusion", {
      p_ticket: ticketId,
      p_approve: approve,
      p_note: note ?? "",
    });
    if (error) return { error: error.message };

    const { data: t } = await supabase
      .from("tickets")
      .select("assignee_id, created_by, code, title")
      .eq("id", ticketId)
      .maybeSingle();
    const target = t?.assignee_id ?? t?.created_by ?? null;
    if (target && target !== userId) {
      await supabase.rpc("notify_users", {
        p_tenant: tenantId,
        p_users: [target],
        p_type: "ticket",
        p_title: `Chamado ${t?.code ?? ""} ${approve ? "encerrado" : "reaberto"}`.trim(),
        p_body: approve
          ? `O solicitante deu o de acordo e o chamado "${t?.title}" foi encerrado.`
          : `O solicitante recusou a conclusão de "${t?.title}"; o chamado voltou para atendimento.`,
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
export type TicketComment = { id: string; body: string; authorId: string | null; authorName: string | null; createdAt: string };

export async function getTicketComments(ticketId: string): Promise<TicketComment[]> {
  const { supabase } = await actionContext();
  const { data } = await supabase
    .from("ticket_comments")
    .select("id, body, created_at, author_id, author:profiles!author_id(full_name)")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  return (data ?? []).map((c) => ({
    id: c.id,
    body: c.body,
    authorId: c.author_id,
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

/** Define os setores que um gestor de chamados atende (substitui os anteriores). owner/admin. */
export async function setTicketManagerSectors(input: { user_id: string; sector_ids: string[] }): Promise<ActionState> {
  try {
    const { tenantId, role } = await actionContext();
    if (role !== "owner" && role !== "admin") return { error: "Apenas owner/admin podem designar gestores de chamado." };
    if (!input.user_id) return { error: "Usuário inválido." };
    const admin = createServiceClient();
    // mantém só os setores válidos do tenant
    const { data: valid } = await admin.from("ticket_sectors").select("id").eq("tenant_id", tenantId);
    const validIds = new Set((valid ?? []).map((s) => s.id));
    const sectorIds = [...new Set(input.sector_ids.filter((id) => validIds.has(id)))];
    // substitui as linhas do usuário
    await admin.from("ticket_manager_sectors").delete().eq("tenant_id", tenantId).eq("user_id", input.user_id);
    if (sectorIds.length) {
      const rows = sectorIds.map((sid) => ({ tenant_id: tenantId, user_id: input.user_id, sector_id: sid }));
      const { error } = await admin.from("ticket_manager_sectors").insert(rows);
      if (error) return { error: error.message };
    }
    // is_ticket_manager reflete "tem ao menos um setor"
    await admin.from("memberships").update({ is_ticket_manager: sectorIds.length > 0 }).eq("tenant_id", tenantId).eq("user_id", input.user_id);
    revalidatePath("/configuracoes");
    revalidatePath("/chamados");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setTicketStatus(formData: FormData): Promise<void> {
  const ctx = await actionContext();
  const { supabase } = ctx;
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as Enums<"ticket_status">;
  const done = status === "resolved" || status === "closed";

  // A RLS já recusa quem não é solicitante, gestor do setor ou owner/admin. A
  // checagem aqui existe para o usuário ver o motivo em português, em vez de a
  // atualização sumir sem dizer nada (update recusado pela RLS afeta 0 linhas).
  if (!(await podeTratarChamado(ctx, id))) return;

  await supabase
    .from("tickets")
    .update({ status, resolved_at: done ? new Date().toISOString() : null })
    .eq("id", id);
  revalidatePath("/chamados");
  revalidatePath("/dashboard");
}

export async function deleteTicket(formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return { error: "Apenas owner ou admin podem excluir um chamado." };
  }
  const { error } = await ctx.supabase.from("tickets").delete().eq("id", String(formData.get("id")));
  if (error) return { error: error.message };
  revalidatePath("/chamados");
  revalidatePath("/dashboard");
  return { ok: true };
}

// ---------- Configuração: Setores ----------
export async function createTicketSector(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await adminActionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("ticket_sectors").insert({ tenant_id: tenantId, name });
  revalidatePath(RP);
  revalidatePath("/chamados");
}
export async function setTicketSectorActive(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  await supabase.from("ticket_sectors").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidatePath(RP);
  revalidatePath("/chamados");
}
export async function deleteTicketSector(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  const id = String(formData.get("id"));
  // em uso se algum chamado referencia o setor OU alguma categoria dele já foi usada em chamados
  let used = await isCatalogInUse(supabase, id, [{ table: "tickets", col: "sector_id" }]);
  if (!used) {
    const { data: cats } = await supabase.from("ticket_categories").select("id").eq("sector_id", id);
    const catIds = (cats ?? []).map((c) => c.id);
    if (catIds.length) {
      const { count } = await supabase.from("tickets").select("*", { count: "exact", head: true }).in("category_id", catIds);
      used = (count ?? 0) > 0;
    }
  }
  if (used) { await setTicketSectorActive(formData); return; }
  await supabase.from("ticket_sectors").delete().eq("id", id);
  revalidatePath(RP);
  revalidatePath("/chamados");
}

// ---------- Configuração: Categorias ----------
export async function createTicketCategory(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await adminActionContext();
  const name = String(formData.get("name") ?? "").trim();
  const sector_id = String(formData.get("sector_id") ?? "");
  if (!name || !sector_id) return;
  await supabase.from("ticket_categories").insert({ tenant_id: tenantId, sector_id, name });
  revalidatePath(RP);
  revalidatePath("/chamados");
}
export async function setTicketCategoryActive(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  await supabase.from("ticket_categories").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidatePath(RP);
  revalidatePath("/chamados");
}
export async function deleteTicketCategory(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  const id = String(formData.get("id"));
  const used = await isCatalogInUse(supabase, id, [{ table: "tickets", col: "category_id" }]);
  if (used) { await setTicketCategoryActive(formData); return; }
  await supabase.from("ticket_categories").delete().eq("id", id);
  revalidatePath(RP);
  revalidatePath("/chamados");
}

// ---------- Configuração: modo do SLA (exige confirmação de senha) ----------
export async function setTicketSlaMode(mode: SlaMode, password: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (ctx.role !== "owner" && ctx.role !== "admin") return { error: "Apenas proprietário e administrador podem alterar o modo do SLA." };
    if (mode !== "priority" && mode !== "category") return { error: "Modo inválido." };
    if (!(await verifyOwnPassword(password))) return { error: "Senha inválida." };
    const { error } = await ctx.supabase.from("tenants").update({ ticket_sla_mode: mode }).eq("id", ctx.tenantId);
    if (error) return { error: error.message };
    revalidatePath(RP);
    revalidatePath("/chamados");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- Configuração: SLA (categoria × prioridade, ou só categoria com priority null) ----------
export async function setTicketSla(input: {
  category_id: string;
  priority: Enums<"priority_level"> | null;
  sla_value: number;
  sla_unit: Enums<"ticket_sla_unit">;
}): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    if (!input.category_id) return { error: "Categoria inválida." };
    const value = Math.max(0, Math.round(Number(input.sla_value) || 0));
    // upsert manual (índices parciais impedem onConflict genérico)
    let sel = supabase.from("ticket_slas").select("id").eq("tenant_id", tenantId).eq("category_id", input.category_id);
    sel = input.priority == null ? sel.is("priority", null) : sel.eq("priority", input.priority);
    const { data: existing } = await sel.maybeSingle();
    if (existing) {
      const { error } = await supabase.from("ticket_slas").update({ sla_value: value, sla_unit: input.sla_unit }).eq("id", existing.id);
      if (error) return { error: error.message };
    } else {
      const { error } = await supabase.from("ticket_slas").insert({ tenant_id: tenantId, category_id: input.category_id, priority: input.priority, sla_value: value, sla_unit: input.sla_unit });
      if (error) return { error: error.message };
    }
    revalidatePath(RP);
    revalidatePath("/chamados");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- Importação em lote (Chamados) ----------
const normTk = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export type TicketStructureRow = { setor: string; categoria: string };
export type TicketStructureResult = { rows: number; setoresCreated: number; categoriasCreated: number; skipped: number; error?: string };

/** Importa Setores e Categorias de chamado (Setor cria-se se faltar; Categoria dentro do setor da linha). */
export async function importTicketStructure(rows: TicketStructureRow[]): Promise<TicketStructureResult> {
  const base: TicketStructureResult = { rows: rows.length, setoresCreated: 0, categoriasCreated: 0, skipped: 0 };
  try {
    const { supabase, tenantId, role } = await actionContext();
    if (role !== "owner" && role !== "admin") return { ...base, error: "Apenas proprietário e administrador podem importar." };
    const [{ data: sectors }, { data: cats }] = await Promise.all([
      supabase.from("ticket_sectors").select("id, name").eq("tenant_id", tenantId),
      supabase.from("ticket_categories").select("id, name, sector_id").eq("tenant_id", tenantId),
    ]);
    const sectorByName = new Map<string, string>();
    for (const s of sectors ?? []) sectorByName.set(normTk(s.name), s.id);
    const catByKey = new Map<string, string>();
    for (const c of cats ?? []) catByKey.set(`${c.sector_id}|${normTk(c.name)}`, c.id);

    for (const r of rows) {
      const setor = (r.setor ?? "").trim();
      if (!setor) { base.skipped += 1; continue; }
      let sectorId = sectorByName.get(normTk(setor));
      if (!sectorId) {
        const { data, error } = await supabase.from("ticket_sectors").insert({ tenant_id: tenantId, name: setor }).select("id").single();
        if (error || !data) return { ...base, error: `Setor "${setor}": ${error?.message ?? "falha ao criar"}` };
        sectorId = data.id;
        sectorByName.set(normTk(setor), sectorId);
        base.setoresCreated += 1;
      }
      const categoria = (r.categoria ?? "").trim();
      if (!categoria) continue;
      const key = `${sectorId}|${normTk(categoria)}`;
      if (!catByKey.get(key)) {
        const { data, error } = await supabase.from("ticket_categories").insert({ tenant_id: tenantId, sector_id: sectorId, name: categoria }).select("id").single();
        if (error || !data) return { ...base, error: `Categoria "${categoria}": ${error?.message ?? "falha ao criar"}` };
        catByKey.set(key, data.id);
        base.categoriasCreated += 1;
      }
    }
    revalidatePath(RP);
    revalidatePath("/chamados");
    return base;
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}

export type TicketSlaRow = { setor: string; categoria: string; prioridade: string; valor: string; unidade: string };
export type TicketSlaImportResult = { rows: number; slasSet: number; skipped: number; error?: string };

const parsePriority = (raw: string): { ok: true; value: Enums<"priority_level"> | null } | { ok: false } => {
  const n = normTk(raw);
  if (!n) return { ok: true, value: null }; // vazio = SLA por categoria
  if (n.startsWith("baix") || n === "low") return { ok: true, value: "low" };
  if (n.startsWith("med") || n === "medium") return { ok: true, value: "medium" };
  if (n.startsWith("alt") || n === "high") return { ok: true, value: "high" };
  if (n.startsWith("urg") || n === "urgent") return { ok: true, value: "urgent" };
  return { ok: false };
};
const parseUnit = (raw: string): Enums<"ticket_sla_unit"> => {
  const n = normTk(raw);
  if (n.includes("hora")) return "horas";
  if (n.includes("corrid")) return "dias_corridos";
  return "dias_uteis"; // padrão (inclui "dias úteis" e vazio)
};

/** Importa SLAs de chamado. Prioridade vazia = SLA por categoria (priority null). Cria setor/categoria se faltar. */
export async function importTicketSlas(rows: TicketSlaRow[]): Promise<TicketSlaImportResult> {
  const base: TicketSlaImportResult = { rows: rows.length, slasSet: 0, skipped: 0 };
  try {
    const { supabase, tenantId, role } = await actionContext();
    if (role !== "owner" && role !== "admin") return { ...base, error: "Apenas proprietário e administrador podem importar." };
    const [{ data: sectors }, { data: cats }] = await Promise.all([
      supabase.from("ticket_sectors").select("id, name").eq("tenant_id", tenantId),
      supabase.from("ticket_categories").select("id, name, sector_id").eq("tenant_id", tenantId),
    ]);
    const sectorByName = new Map<string, string>();
    for (const s of sectors ?? []) sectorByName.set(normTk(s.name), s.id);
    const catByKey = new Map<string, string>();
    for (const c of cats ?? []) catByKey.set(`${c.sector_id}|${normTk(c.name)}`, c.id);

    for (const r of rows) {
      const setor = (r.setor ?? "").trim();
      const categoria = (r.categoria ?? "").trim();
      if (!setor || !categoria) { base.skipped += 1; continue; }
      let sectorId = sectorByName.get(normTk(setor));
      if (!sectorId) {
        const { data, error } = await supabase.from("ticket_sectors").insert({ tenant_id: tenantId, name: setor }).select("id").single();
        if (error || !data) return { ...base, error: `Setor "${setor}": ${error?.message ?? "falha ao criar"}` };
        sectorId = data.id; sectorByName.set(normTk(setor), sectorId);
      }
      const catKey = `${sectorId}|${normTk(categoria)}`;
      let catId = catByKey.get(catKey);
      if (!catId) {
        const { data, error } = await supabase.from("ticket_categories").insert({ tenant_id: tenantId, sector_id: sectorId, name: categoria }).select("id").single();
        if (error || !data) return { ...base, error: `Categoria "${categoria}": ${error?.message ?? "falha ao criar"}` };
        catId = data.id; catByKey.set(catKey, catId);
      }
      const pr = parsePriority(r.prioridade ?? "");
      if (!pr.ok) { base.skipped += 1; continue; }
      const unit = parseUnit(r.unidade ?? "");
      const value = Math.max(0, Math.round(Number(String(r.valor ?? "").replace(",", ".")) || 0));
      // upsert manual do SLA
      let sel = supabase.from("ticket_slas").select("id").eq("tenant_id", tenantId).eq("category_id", catId);
      sel = pr.value == null ? sel.is("priority", null) : sel.eq("priority", pr.value);
      const { data: existing } = await sel.maybeSingle();
      if (existing) {
        const { error } = await supabase.from("ticket_slas").update({ sla_value: value, sla_unit: unit }).eq("id", existing.id);
        if (error) return { ...base, error: `SLA "${categoria}": ${error.message}` };
      } else {
        const { error } = await supabase.from("ticket_slas").insert({ tenant_id: tenantId, category_id: catId, priority: pr.value, sla_value: value, sla_unit: unit });
        if (error) return { ...base, error: `SLA "${categoria}": ${error.message}` };
      }
      base.slasSet += 1;
    }
    revalidatePath(RP);
    revalidatePath("/chamados");
    return base;
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}
