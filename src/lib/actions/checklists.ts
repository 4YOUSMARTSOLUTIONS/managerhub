"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums, Json } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const BUCKET = "checklist-photos";
function isAdminRole(role: Enums<"member_role">) { return role === "owner" || role === "admin"; }
type Ctx = { supabase: SupabaseClient<Database>; tenantId: string; userId: string; role: Enums<"member_role"> };

/** true se o usuário pode editar o checklist: admin, criador, ou gestor do criador. */
async function canEditChecklist(ctx: Ctx, checklistId: string): Promise<boolean> {
  const { data: c } = await ctx.supabase.from("checklists").select("created_by").eq("id", checklistId).maybeSingle();
  if (!c) return false;
  if (isAdminRole(ctx.role) || c.created_by === ctx.userId) return true;
  const { data } = await ctx.supabase.from("memberships").select("user_id")
    .eq("tenant_id", ctx.tenantId).eq("user_id", c.created_by).eq("manager_id", ctx.userId).maybeSingle();
  return !!data;
}

const clean = (v: string | null | undefined) => (v ?? "").trim() || null;

// ---------- tipos de entrada ----------
export type ChecklistItemInput = {
  section?: string | null; label: string; help?: string | null;
  type: Enums<"checklist_item_type">; required?: boolean; allow_photo?: boolean; allow_na?: boolean;
  require_note_on_nc?: boolean; require_photo_on_nc?: boolean; options?: string[] | null;
};
export type AudienceInput = { kind: "user" | "position" | "department"; ref_id: string };
export type ChecklistInput = {
  id?: string;
  unit_id?: string | null; name: string; description?: string | null;
  department_id?: string | null; subdepartment_id?: string | null;
  visibility: Enums<"checklist_visibility">; default_assignee_id?: string | null; auto_open_tasks?: boolean;
  items: ChecklistItemInput[];
  audiences?: AudienceInput[];
};

async function saveItemsAudiences(ctx: Ctx, checklistId: string, input: ChecklistInput) {
  await ctx.supabase.from("checklist_items").delete().eq("checklist_id", checklistId);
  if (input.items.length) {
    await ctx.supabase.from("checklist_items").insert(input.items.map((it, i) => ({
      tenant_id: ctx.tenantId, checklist_id: checklistId,
      section: clean(it.section), sort: i, label: it.label.trim(), help: clean(it.help),
      type: it.type, required: it.required ?? true, allow_photo: it.allow_photo ?? false, allow_na: it.allow_na ?? true,
      require_note_on_nc: it.require_note_on_nc ?? false, require_photo_on_nc: it.require_photo_on_nc ?? false,
      options: (it.options && it.options.length ? it.options : null) as Json | null,
    })));
  }
  await ctx.supabase.from("checklist_audiences").delete().eq("checklist_id", checklistId);
  const aud = input.visibility === "todos" ? [] : (input.audiences ?? []);
  if (aud.length) {
    await ctx.supabase.from("checklist_audiences").insert(aud.map((a) => ({ tenant_id: ctx.tenantId, checklist_id: checklistId, kind: a.kind, ref_id: a.ref_id })));
  }
}

export async function createChecklist(input: ChecklistInput): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome do checklist." };
    if (!input.items?.some((i) => i.label.trim())) return { error: "Adicione ao menos um item." };
    const { data: cl, error } = await ctx.supabase.from("checklists").insert({
      tenant_id: ctx.tenantId, unit_id: input.unit_id || null, name, description: clean(input.description),
      department_id: input.department_id || null, subdepartment_id: input.subdepartment_id || null,
      visibility: input.visibility, default_assignee_id: input.default_assignee_id || null, auto_open_tasks: input.auto_open_tasks ?? true, created_by: ctx.userId,
    }).select("id").single();
    if (error) return { error: error.message };
    await saveItemsAudiences(ctx, cl.id, input);
    revalidatePath("/checklists");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function updateChecklist(input: ChecklistInput): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!input.id) return { error: "Checklist inválido." };
    if (!(await canEditChecklist(ctx, input.id))) return { error: "Você não tem permissão para editar este checklist." };
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome do checklist." };
    const { error } = await ctx.supabase.from("checklists").update({
      unit_id: input.unit_id || null, name, description: clean(input.description),
      department_id: input.department_id || null, subdepartment_id: input.subdepartment_id || null,
      visibility: input.visibility, default_assignee_id: input.default_assignee_id || null, auto_open_tasks: input.auto_open_tasks ?? true, updated_at: new Date().toISOString(),
    }).eq("id", input.id);
    if (error) return { error: error.message };
    await saveItemsAudiences(ctx, input.id, input);
    revalidatePath("/checklists");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function deleteChecklist(id: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!(await canEditChecklist(ctx, id))) return { error: "Sem permissão para excluir." };
    const { error } = await ctx.supabase.from("checklists").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/checklists");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function toggleChecklistActive(input: { id: string; active: boolean }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!(await canEditChecklist(ctx, input.id))) return { error: "Sem permissão." };
    const { error } = await ctx.supabase.from("checklists").update({ active: input.active, updated_at: new Date().toISOString() }).eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath("/checklists");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

// ---------- agendamento ----------
export async function saveSchedule(input: {
  id?: string; // presente = edição
  checklist_id: string; frequency: Enums<"checklist_frequency">;
  fixed_date?: string | null; weekday?: number | null; day_of_month?: number | null; run_time?: string | null;
  targets: AudienceInput[];
}): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!(await canEditChecklist(ctx, input.checklist_id))) return { error: "Sem permissão para agendar este checklist." };
    if (!input.targets?.length) return { error: "Selecione ao menos um responsável (usuário, cargo ou área)." };

    const fields = {
      frequency: input.frequency,
      fixed_date: input.fixed_date || null, weekday: input.weekday ?? null, day_of_month: input.day_of_month ?? null,
      run_time: input.run_time || null,
    };

    let scheduleId = input.id ?? null;
    if (scheduleId) {
      const { error } = await ctx.supabase.from("checklist_schedules").update(fields)
        .eq("id", scheduleId).eq("checklist_id", input.checklist_id);
      if (error) return { error: error.message };
      await ctx.supabase.from("checklist_schedule_targets").delete().eq("schedule_id", scheduleId);
    } else {
      const { data: s, error } = await ctx.supabase.from("checklist_schedules").insert({
        tenant_id: ctx.tenantId, checklist_id: input.checklist_id, created_by: ctx.userId, ...fields,
      }).select("id").single();
      if (error) return { error: error.message };
      scheduleId = s.id;
    }

    await ctx.supabase.from("checklist_schedule_targets").insert(input.targets.map((t) => ({ tenant_id: ctx.tenantId, schedule_id: scheduleId, kind: t.kind, ref_id: t.ref_id })));
    revalidatePath("/checklists");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function deleteSchedule(id: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { error } = await ctx.supabase.from("checklist_schedules").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/checklists");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

// ---------- execução ----------
type AnswerInput = {
  item_id: string; type: Enums<"checklist_item_type">;
  conformidade?: "conforme" | "nao_conforme" | "na" | null;
  bool?: boolean | null; text?: string | null; number?: number | null; option?: string | null; note?: string | null;
};
type RunPayload = { checklist_id: string; run_id?: string | null; schedule_id?: string | null; unit_id?: string | null; period_key?: string | null; started_at?: string | null; answers: AnswerInput[] };

/** Rascunhos (status em_andamento) expiram em 1h; some antes de gravar/ler. */
const DRAFT_TTL_MS = 60 * 60 * 1000;

async function persistRun(ctx: Ctx, formData: FormData, p: RunPayload, finalize: boolean): Promise<ActionState & { runId?: string }> {
  let conform = 0, nonconform = 0, na = 0;
  for (const a of p.answers) {
    if (a.type === "conformidade") {
      if (a.conformidade === "conforme") conform++;
      else if (a.conformidade === "nao_conforme") nonconform++;
      else if (a.conformidade === "na") na++;
    }
  }
  const avaliaveis = conform + nonconform;
  const score = avaliaveis > 0 ? Math.round((conform / avaliaveis) * 100) : null;

  // reaproveita o run existente: id explícito (rascunho) ou dedup por (checklist, executor, period_key)
  let runId: string | null = p.run_id || null;
  if (!runId && p.period_key) {
    const { data: ex } = await ctx.supabase.from("checklist_runs").select("id")
      .eq("checklist_id", p.checklist_id).eq("executor_id", ctx.userId).eq("period_key", p.period_key).maybeSingle();
    runId = ex?.id ?? null;
  }
  const runPatch = {
    status: finalize ? ("concluida" as const) : ("em_andamento" as const),
    score, conform_count: conform, nonconform_count: nonconform, na_count: na,
    completed_at: finalize ? new Date().toISOString() : null,
    unit_id: p.unit_id || null, schedule_id: p.schedule_id || null,
  };
  if (runId) {
    // só o próprio executor atualiza o seu run (RLS garante, mas confirmamos o vínculo)
    const { error } = await ctx.supabase.from("checklist_runs").update(runPatch).eq("id", runId).eq("executor_id", ctx.userId);
    if (error) return { error: error.message };
    await ctx.supabase.from("checklist_run_answers").delete().eq("run_id", runId);
  } else {
    // started_at = início real da execução (informado pelo cliente); atualizações não o alteram
    const { data: run, error } = await ctx.supabase.from("checklist_runs").insert({
      tenant_id: ctx.tenantId, checklist_id: p.checklist_id, executor_id: ctx.userId, period_key: p.period_key || null,
      ...(p.started_at ? { started_at: p.started_at } : {}), ...runPatch,
    }).select("id").single();
    if (error) return { error: error.message };
    runId = run.id;
  }

  if (p.answers.length) {
    await ctx.supabase.from("checklist_run_answers").insert(p.answers.map((a) => ({
      tenant_id: ctx.tenantId, run_id: runId!, item_id: a.item_id,
      value_conformidade: a.type === "conformidade" ? (a.conformidade ?? null) : null,
      value_bool: a.type === "sim_nao" ? (a.bool ?? null) : null,
      value_text: a.type === "texto" ? clean(a.text) : null,
      value_number: a.type === "numero" ? (a.number ?? null) : null,
      value_option: a.type === "selecao" || a.type === "nota" ? clean(a.option) : null,
      note: clean(a.note),
    })));
  }

  // fotos só na finalização (não são guardadas no rascunho)
  if (finalize) {
    for (const a of p.answers) {
      const files = formData.getAll(`photo:${a.item_id}`) as File[];
      for (const file of files) {
        if (!(file instanceof File) || file.size === 0) continue;
        const safe = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${ctx.tenantId}/${runId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
        const up = await ctx.supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (up.error) continue;
        await ctx.supabase.from("checklist_answer_photos").insert({
          tenant_id: ctx.tenantId, run_id: runId!, item_id: a.item_id, path, filename: file.name, size: file.size, content_type: file.type || null, uploaded_by: ctx.userId,
        });
      }
    }

    // "não conformidade" gera tarefa para o responsável (fixo do checklist, ou o criador),
    // desde que o checklist esteja configurado para abrir tarefas automaticamente
    const nc = p.answers.filter((a) => a.type === "conformidade" && a.conformidade === "nao_conforme");
    const { data: cl } = nc.length
      ? await ctx.supabase.from("checklists").select("default_assignee_id, created_by, auto_open_tasks").eq("id", p.checklist_id).maybeSingle()
      : { data: null };
    if (nc.length && (cl?.auto_open_tasks ?? true)) {
      const assignee = cl?.default_assignee_id ?? cl?.created_by ?? ctx.userId;
      const { data: items } = await ctx.supabase.from("checklist_items").select("id, label").in("id", nc.map((a) => a.item_id));
      const labelById = new Map((items ?? []).map((i) => [i.id, i.label]));
      // não recria tarefas já existentes desta execução (evita duplicar em reenvios)
      const { data: existing } = await ctx.supabase.from("checklist_tasks").select("item_id").eq("run_id", runId!);
      const has = new Set((existing ?? []).map((t) => t.item_id));
      const toCreate = nc.filter((a) => !has.has(a.item_id));
      if (toCreate.length) {
        await ctx.supabase.from("checklist_tasks").insert(toCreate.map((a) => ({
          tenant_id: ctx.tenantId, checklist_id: p.checklist_id, run_id: runId!, item_id: a.item_id, unit_id: p.unit_id || null,
          title: labelById.get(a.item_id) ?? "Não conformidade", description: clean(a.note),
          assignee_id: assignee, status: "pendente" as const, created_by: ctx.userId,
        })));
      }
    }
  }

  revalidatePath("/checklists");
  return { ok: true, runId: runId! };
}

export async function submitRun(formData: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const raw = String(formData.get("payload") ?? "");
    if (!raw) return { error: "Dados inválidos." };
    const p = JSON.parse(raw) as RunPayload;
    if (!p.checklist_id) return { error: "Checklist inválido." };
    return await persistRun(ctx, formData, p, true);
  } catch (e) { return { error: (e as Error).message }; }
}

/** Salva/atualiza um rascunho (status em_andamento). Retorna o runId para os próximos saves. */
export async function saveDraftRun(formData: FormData): Promise<ActionState & { runId?: string }> {
  try {
    const ctx = await actionContext();
    const raw = String(formData.get("payload") ?? "");
    if (!raw) return { error: "Dados inválidos." };
    const p = JSON.parse(raw) as RunPayload;
    if (!p.checklist_id) return { error: "Checklist inválido." };
    return await persistRun(ctx, formData, p, false);
  } catch (e) { return { error: (e as Error).message }; }
}

/** Remove rascunhos (em_andamento) do tenant que passaram de 1h sem finalizar. */
export async function purgeStaleChecklistDrafts(): Promise<void> {
  try {
    const ctx = await actionContext();
    const cutoff = new Date(Date.now() - DRAFT_TTL_MS).toISOString();
    // rascunhos não têm fotos (só finalização anexa), então apagar o run já limpa tudo (cascade nas respostas)
    await ctx.supabase.from("checklist_runs").delete()
      .eq("tenant_id", ctx.tenantId).eq("status", "em_andamento").lt("started_at", cutoff);
  } catch { /* limpeza best-effort */ }
}

export async function deleteRun(id: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { data: photos } = await ctx.supabase.from("checklist_answer_photos").select("path").eq("run_id", id);
    const paths = (photos ?? []).map((x) => x.path);
    if (paths.length) { const rm = await ctx.supabase.storage.from(BUCKET).remove(paths); if (rm.error) console.error("checklist photo cleanup:", rm.error.message); }
    const { error } = await ctx.supabase.from("checklist_runs").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/checklists");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function getChecklistPhotoUrl(path: string): Promise<string | null> {
  try {
    const { supabase } = await actionContext();
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
    return data?.signedUrl ?? null;
  } catch { return null; }
}

// ---------- tarefas geradas por não conformidade ----------
export async function addChecklistTaskComment(input: { task_id: string; body: string }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const body = (input.body ?? "").trim();
    if (!body) return { error: "Escreva um comentário." };
    const { error } = await ctx.supabase.from("checklist_task_comments").insert({
      tenant_id: ctx.tenantId, task_id: input.task_id, author_id: ctx.userId, body,
    });
    if (error) return { error: error.message };
    revalidatePath("/checklists");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function updateChecklistTaskStatus(input: { task_id: string; status: Enums<"checklist_task_status">; resolution?: string | null }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const done = input.status === "concluida" || input.status === "cancelada";
    const { error } = await ctx.supabase.from("checklist_tasks").update({
      status: input.status, resolution: clean(input.resolution), resolved_at: done ? new Date().toISOString() : null,
    }).eq("id", input.task_id);
    if (error) return { error: error.message };
    revalidatePath("/checklists");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

