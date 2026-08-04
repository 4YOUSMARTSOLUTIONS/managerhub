"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { recusaDeUpload, TAMANHO_ANEXO, MIMES_ANEXO } from "@/lib/uploads";

const BUCKET = "agenda-attachments";
type Ctx = { supabase: SupabaseClient<Database>; tenantId: string; userId: string; role: Enums<"member_role"> };
const clean = (v: string | null | undefined) => (v ?? "").trim() || null;
const numOrNull = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; };

// ---------- tipos de entrada ----------
export type AgendaTaskInput = {
  id?: string;
  title: string;
  description?: string | null;
  scheduled_time?: string | null; // HH:MM
  duration_minutes?: number;
  frequency: Enums<"agenda_frequency">;
  weekdays?: number[];
  day_of_month?: number | null;
  fixed_date?: string | null;
  active?: boolean;
  flexible?: boolean;
};
export type AgendaInput = {
  id?: string;
  name: string;
  description?: string | null;
  unit_id?: string | null;
  responsible_id: string;
  can_responsible_edit?: boolean;
  tasks: AgendaTaskInput[];
};

function taskRow(ctx: Ctx, agendaId: string, t: AgendaTaskInput, sort: number) {
  const flexible = t.flexible ?? false;
  return {
    tenant_id: ctx.tenantId,
    agenda_id: agendaId,
    title: t.title.trim(),
    description: clean(t.description),
    scheduled_time: flexible ? null : clean(t.scheduled_time),
    duration_minutes: Math.max(0, Math.round(t.duration_minutes ?? 30)),
    frequency: t.frequency,
    weekdays: t.frequency === "semanal" ? (t.weekdays ?? []) : [],
    day_of_month: t.frequency === "mensal" ? numOrNull(t.day_of_month) : null,
    fixed_date: t.frequency === "unica" ? clean(t.fixed_date) : null,
    sort,
    active: t.active ?? true,
    flexible,
  };
}

/** Sincroniza as tarefas preservando as existentes (mantém o histórico de logs). */
async function syncTasks(ctx: Ctx, agendaId: string, tasks: AgendaTaskInput[]) {
  const { data: existing } = await ctx.supabase.from("agenda_tasks").select("id").eq("agenda_id", agendaId);
  const keepIds = new Set(tasks.map((t) => t.id).filter(Boolean) as string[]);
  const toDelete = (existing ?? []).map((x) => x.id).filter((id) => !keepIds.has(id));
  if (toDelete.length) await ctx.supabase.from("agenda_tasks").delete().in("id", toDelete);

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (!t.title?.trim()) continue;
    const row = taskRow(ctx, agendaId, t, i);
    if (t.id) await ctx.supabase.from("agenda_tasks").update(row).eq("id", t.id);
    else await ctx.supabase.from("agenda_tasks").insert(row);
  }
}

export async function createAgenda(input: AgendaInput): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!input.name?.trim()) return { error: "Informe o nome da agenda." };
    if (!input.responsible_id) return { error: "Escolha o responsável pela agenda." };
    const { data: ag, error } = await ctx.supabase.from("agendas").insert({
      tenant_id: ctx.tenantId,
      unit_id: clean(input.unit_id),
      name: input.name.trim(),
      description: clean(input.description),
      owner_id: ctx.userId,
      responsible_id: input.responsible_id,
      can_responsible_edit: input.responsible_id === ctx.userId ? true : (input.can_responsible_edit ?? false),
      created_by: ctx.userId,
    }).select("id").single();
    if (error) return { error: error.message };
    await syncTasks(ctx, ag.id, input.tasks ?? []);
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function updateAgenda(input: AgendaInput): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!input.id) return { error: "Agenda inválida." };
    if (!input.name?.trim()) return { error: "Informe o nome da agenda." };
    const { error } = await ctx.supabase.from("agendas").update({
      name: input.name.trim(),
      description: clean(input.description),
      unit_id: clean(input.unit_id),
      responsible_id: input.responsible_id,
      can_responsible_edit: input.responsible_id === ctx.userId ? true : (input.can_responsible_edit ?? false),
      updated_at: new Date().toISOString(),
    }).eq("id", input.id);
    if (error) return { error: error.message };
    await syncTasks(ctx, input.id, input.tasks ?? []);
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function toggleAgendaActive(input: { id: string; active: boolean }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { error } = await ctx.supabase.from("agendas")
      .update({ active: input.active, updated_at: new Date().toISOString() }).eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function deleteAgenda(formData: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const id = String(formData.get("id") ?? "");
    if (!id) return { error: "Agenda inválida." };
    // limpa anexos do storage antes de remover (cascade apaga as linhas)
    const { data: atts } = await ctx.supabase.from("agenda_log_attachments").select("path")
      .in("log_id", (await ctx.supabase.from("agenda_logs").select("id").eq("agenda_id", id)).data?.map((l) => l.id) ?? []);
    const paths = (atts ?? []).map((a) => a.path);
    if (paths.length) { const rm = await ctx.supabase.storage.from(BUCKET).remove(paths); if (rm.error) console.error("agenda att cleanup:", rm.error.message); }
    const { error } = await ctx.supabase.from("agendas").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

// ---------- Logs (preenchimento diário) ----------
/** Garante que existe um log (task_id, log_date); retorna o id. Não altera status existente. */
async function ensureLog(ctx: Ctx, agendaId: string, taskId: string, logDate: string): Promise<string | null> {
  const { data: found } = await ctx.supabase.from("agenda_logs").select("id")
    .eq("task_id", taskId).eq("log_date", logDate).maybeSingle();
  if (found) return found.id;
  const { data: ins, error } = await ctx.supabase.from("agenda_logs").insert({
    tenant_id: ctx.tenantId, agenda_id: agendaId, task_id: taskId, log_date: logDate, status: "pendente",
  }).select("id").single();
  if (error) return null;
  return ins.id;
}

export async function openLog(input: { agenda_id: string; task_id: string; log_date: string }): Promise<ActionState & { logId?: string }> {
  try {
    const ctx = await actionContext();
    const logId = await ensureLog(ctx, input.agenda_id, input.task_id, input.log_date);
    if (!logId) return { error: "Não foi possível abrir o registro." };
    return { ok: true, logId };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function setLogStatus(input: {
  agenda_id: string; task_id: string; log_date: string;
  status: Enums<"agenda_log_status">; note?: string | null; actual_minutes?: number | null;
}): Promise<ActionState & { logId?: string }> {
  try {
    const ctx = await actionContext();
    const done = input.status !== "pendente";
    const { data, error } = await ctx.supabase.from("agenda_logs").upsert({
      tenant_id: ctx.tenantId,
      agenda_id: input.agenda_id,
      task_id: input.task_id,
      log_date: input.log_date,
      status: input.status,
      note: clean(input.note),
      actual_minutes: numOrNull(input.actual_minutes),
      done_by: done ? ctx.userId : null,
      done_at: done ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "task_id,log_date" }).select("id").single();
    if (error) return { error: error.message };
    revalidatePath("/agenda");
    return { ok: true, logId: data.id };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function addLogComment(input: { log_id: string; body: string }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!input.body?.trim()) return { error: "Escreva um comentário." };
    const { error } = await ctx.supabase.from("agenda_log_comments").insert({
      tenant_id: ctx.tenantId, log_id: input.log_id, author_id: ctx.userId, body: input.body.trim(),
    });
    if (error) return { error: error.message };
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function uploadLogAttachments(formData: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const logId = String(formData.get("log_id") ?? "");
    if (!logId) return { error: "Registro inválido." };
    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    for (const f of files) { const r = recusaDeUpload(f, TAMANHO_ANEXO, MIMES_ANEXO); if (r) return { error: r }; }
    for (const file of files) {
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${ctx.tenantId}/${logId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
      const up = await ctx.supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (up.error) return { error: up.error.message };
      const { error } = await ctx.supabase.from("agenda_log_attachments").insert({
        tenant_id: ctx.tenantId, log_id: logId, path, filename: file.name,
        size: file.size, content_type: file.type || null, uploaded_by: ctx.userId,
      });
      if (error) return { error: error.message };
    }
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function deleteLogAttachment(id: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { data: att } = await ctx.supabase.from("agenda_log_attachments").select("path").eq("id", id).maybeSingle();
    if (att?.path) { const rm = await ctx.supabase.storage.from(BUCKET).remove([att.path]); if (rm.error) console.error("agenda att cleanup:", rm.error.message); }
    const { error } = await ctx.supabase.from("agenda_log_attachments").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export type LogThread = {
  comments: { id: string; authorId: string; body: string; createdAt: string }[];
  attachments: { id: string; filename: string; path: string; size: number | null }[];
};

export async function getLogThread(logId: string): Promise<LogThread> {
  try {
    const { supabase } = await actionContext();
    const [{ data: comments }, { data: atts }] = await Promise.all([
      supabase.from("agenda_log_comments").select("id, author_id, body, created_at").eq("log_id", logId).order("created_at", { ascending: true }),
      supabase.from("agenda_log_attachments").select("id, filename, path, size").eq("log_id", logId).order("created_at", { ascending: true }),
    ]);
    return {
      comments: (comments ?? []).map((c) => ({ id: c.id, authorId: c.author_id, body: c.body, createdAt: c.created_at })),
      attachments: (atts ?? []).map((a) => ({ id: a.id, filename: a.filename, path: a.path, size: a.size })),
    };
  } catch { return { comments: [], attachments: [] }; }
}

export async function getAgendaAttachmentUrl(path: string): Promise<string | null> {
  try {
    const { supabase } = await actionContext();
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
    return data?.signedUrl ?? null;
  } catch { return null; }
}
