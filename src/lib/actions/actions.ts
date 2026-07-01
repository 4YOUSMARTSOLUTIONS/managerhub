"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

const BUCKET = "action-attachments";

export type ActionPayload = {
  is_sdpo: boolean;
  pilar_id: string;
  bloco_id: string;
  item_id: string;
  meeting_series_id: string;
  occurrence_id: string;
  kpi_id: string;
  tool_id: string;
  requester_id: string;
  due_date: string;
  cc: string[];
  demandas: { description: string; assignees: string[] }[];
};

export async function createAction(formData: FormData): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await actionContext();
    const raw = String(formData.get("payload") ?? "");
    if (!raw) return { error: "Dados inválidos." };
    const payload = JSON.parse(raw) as ActionPayload;

    const demandas = (payload.demandas ?? []).filter((d) => d.description.trim());
    if (demandas.length === 0) return { error: "Informe ao menos uma demanda." };
    if (!payload.requester_id) return { error: "Informe o solicitante." };
    if (!payload.due_date) return { error: "Informe o prazo da ação." };
    if (payload.is_sdpo && (!payload.pilar_id || !payload.bloco_id || !payload.item_id)) {
      return { error: "Para ações do Programa de Excelência, informe Pilar, Bloco e Item." };
    }

    const { data: result, error } = await supabase.rpc("create_action", { p_data: { ...payload, demandas } });
    if (error) return { error: error.message };
    const res = (result ?? {}) as { action_id: string; demanda_ids?: string[] };
    const actionId = res.action_id;
    const demandaIds = res.demanda_ids ?? [];

    const uploadOne = async (file: File, demandaId: string | null) => {
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${tenantId}/${actionId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (up.error) return;
      await supabase.from("action_attachments").insert({
        action_id: actionId,
        demanda_id: demandaId,
        tenant_id: tenantId,
        path,
        filename: file.name,
        size: file.size,
        content_type: file.type || null,
        uploaded_by: userId,
      });
    };

    // anexos gerais (para todas as ações)
    const headerFiles = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    for (const file of headerFiles) await uploadOne(file, null);

    // anexos por demanda/ação (alinhados à ordem das demandas)
    for (let i = 0; i < demandaIds.length; i++) {
      const dFiles = formData.getAll(`files_${i}`).filter((f): f is File => f instanceof File && f.size > 0);
      for (const file of dFiles) await uploadOne(file, demandaIds[i]);
    }

    revalidatePath("/acoes");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- Tratamento da demanda/ação ----------
function rv() {
  revalidatePath("/acoes");
  revalidatePath("/dashboard");
}

export async function demandaSetStatus(demandaId: string, status: Enums<"action_status">): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("demanda_set_status", { p_demanda: demandaId, p_status: status });
    if (error) return { error: error.message };
    rv();
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function demandaComment(demandaId: string, body: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("demanda_comment", { p_demanda: demandaId, p_body: body });
    if (error) return { error: error.message };
    rv();
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function demandaRequest(demandaId: string, type: "prazo" | "conclusao", newDue: string, note: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("demanda_request", { p_demanda: demandaId, p_type: type, p_new_due: newDue || null, p_note: note });
    if (error) return { error: error.message };
    rv();
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function demandaDecide(requestId: string, approve: boolean, note: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("demanda_decide", { p_request: requestId, p_approve: approve, p_note: note });
    if (error) return { error: error.message };
    rv();
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function demandaReopen(demandaId: string, note: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("demanda_reopen", { p_demanda: demandaId, p_note: note });
    if (error) return { error: error.message };
    rv();
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function demandaCancel(demandaId: string, note: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("demanda_cancel", { p_demanda: demandaId, p_note: note });
    if (error) return { error: error.message };
    rv();
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function demandaReassign(demandaId: string, userIds: string[], note: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("demanda_reassign", { p_demanda: demandaId, p_users: userIds, p_note: note });
    if (error) return { error: error.message };
    rv();
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export type TimelineEvent = { id: string; type: string; actorName: string | null; body: string | null; meta: Record<string, unknown>; createdAt: string };
export type PendingReq = { id: string; type: string; newDueDate: string | null; note: string | null; requestedByName: string | null; createdAt: string };

export async function getDemandaTimeline(demandaId: string): Promise<{ events: TimelineEvent[]; requests: PendingReq[]; status: Enums<"action_status">; dueDate: string | null }> {
  const { supabase, tenantId } = await actionContext();
  const [{ data: events }, { data: reqs }, { data: profs }, { data: dem }] = await Promise.all([
    supabase.from("demanda_events").select("id, type, actor_id, body, meta, created_at").eq("demanda_id", demandaId).order("created_at", { ascending: true }),
    supabase.from("demanda_requests").select("id, type, new_due_date, note, requested_by, created_at").eq("demanda_id", demandaId).eq("status", "pending"),
    supabase.from("memberships").select("user_id, profiles!memberships_user_id_fkey(full_name)").eq("tenant_id", tenantId),
    supabase.from("action_demandas").select("status, due_date").eq("id", demandaId).single(),
  ]);
  const nameById = new Map((profs ?? []).map((m) => [m.user_id, (m.profiles as { full_name: string | null } | null)?.full_name ?? "—"]));
  return {
    events: (events ?? []).map((e) => ({ id: e.id, type: e.type, actorName: e.actor_id ? nameById.get(e.actor_id) ?? null : null, body: e.body, meta: (e.meta as Record<string, unknown>) ?? {}, createdAt: e.created_at })),
    requests: (reqs ?? []).map((r) => ({ id: r.id, type: r.type, newDueDate: r.new_due_date, note: r.note, requestedByName: r.requested_by ? nameById.get(r.requested_by) ?? null : null, createdAt: r.created_at })),
    status: (dem?.status ?? "open") as Enums<"action_status">,
    dueDate: dem?.due_date ?? null,
  };
}

export async function deleteAction(formData: FormData): Promise<ActionState> {
  const { supabase, tenantId } = await actionContext();
  const id = String(formData.get("id"));
  // remove anexos do storage (best-effort, mas registra falha p/ não deixar órfão silencioso)
  const { data: atts } = await supabase.from("action_attachments").select("path").eq("action_id", id);
  if (atts && atts.length) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(atts.map((a) => a.path));
    if (rmErr) console.error("[actions] falha ao remover anexos do storage:", rmErr.message);
  }
  const { error } = await supabase.from("actions").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return { error: error.message };
  revalidatePath("/acoes");
  revalidatePath("/dashboard");
  return { ok: true };
}

// URL assinada para download de anexo
export async function getAttachmentUrl(path: string): Promise<string | null> {
  const { supabase } = await actionContext();
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}
