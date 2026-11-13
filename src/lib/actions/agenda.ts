"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { recusaDeUpload, TAMANHO_ANEXO, MIMES_ANEXO } from "@/lib/uploads";
import { fetchAll, emLotes } from "@/lib/supabase/fetch-all";

const BUCKET = "agenda-attachments";
type Ctx = { supabase: SupabaseClient<Database>; tenantId: string; userId: string; role: Enums<"member_role"> };
const clean = (v: string | null | undefined) => (v ?? "").trim() || null;

/**
 * Uma agenda de rotina ativa por pessoa: o gatilho do banco já explica o
 * conflito com nome e dono da outra agenda; só o índice único (dois envios ao
 * mesmo tempo) chega com a mensagem crua do Postgres.
 */
function mensagemDeAgenda(error: { code?: string; message: string }): string {
  if (error.code === "23505" && error.message.includes("agendas_uma_ativa_por_pessoa_idx")) {
    return "Essa pessoa já tem uma agenda de rotina ativa. Cada pessoa tem uma só: edite a que existe ou inative-a antes.";
  }
  return error.message;
}
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
  /** a partir de quando as alterações nas tarefas valem (YYYY-MM-DD; vazio = hoje) */
  desde?: string;
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

/**
 * Grava as tarefas com vigência, numa transação só (`agenda_salvar_tarefas`,
 * 13/11/2026): mudar a recorrência encerra a versão antiga na data e abre uma
 * nova, remover encerra (o histórico fica) e a tarefa nova vale da data em
 * diante. Antes, remover APAGAVA a tarefa com todos os registros dela, e o resto
 * reescrevia o passado. Devolve a mensagem de erro, ou null.
 */
async function syncTasks(ctx: Ctx, agendaId: string, tasks: AgendaTaskInput[], desde?: string): Promise<string | null> {
  const lista = tasks.map((t, i) => {
    const { tenant_id: _tenant, agenda_id: _agenda, ...campos } = taskRow(ctx, agendaId, t, i);
    void _tenant; void _agenda;
    return { id: t.id ?? null, ...campos };
  }).filter((t) => t.title);
  const { error } = await ctx.supabase.rpc("agenda_salvar_tarefas", {
    p_agenda: agendaId, p_tarefas: lista, p_desde: desde || null,
  });
  return error ? error.message : null;
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
    if (error) return { error: mensagemDeAgenda(error) };
    const erroTarefas = await syncTasks(ctx, ag.id, input.tasks ?? []);
    revalidatePath("/agenda");
    if (erroTarefas) return { error: `A agenda foi criada, mas as tarefas não: ${erroTarefas}` };
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
    if (error) return { error: mensagemDeAgenda(error) };
    const erroTarefas = await syncTasks(ctx, input.id, input.tasks ?? [], input.desde);
    revalidatePath("/agenda");
    if (erroTarefas) return { error: erroTarefas };
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function toggleAgendaActive(input: { id: string; active: boolean }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { error } = await ctx.supabase.from("agendas")
      .update({ active: input.active, updated_at: new Date().toISOString() }).eq("id", input.id);
    if (error) return { error: mensagemDeAgenda(error) };
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

/**
 * Passa a agenda para outra pessoa a partir de uma data (hoje ou passada).
 * O banco fecha o período de quem saiu na véspera e abre o do novo: o passado
 * continua com quem fez. Regras e permissão ficam em `agenda_transferir`.
 */
export async function transferirAgenda(input: { agendaId: string; novoId: string; data: string }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!input.agendaId || !input.novoId || !input.data) return { error: "Escolha o novo responsável e a data." };
    const { error } = await ctx.supabase.rpc("agenda_transferir", {
      p_agenda: input.agendaId, p_novo: input.novoId, p_data: input.data,
    });
    if (error) return { error: mensagemDeAgenda(error) };
    revalidatePath("/agenda");
    return { ok: true, message: "Agenda transferida." };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function deleteAgenda(formData: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const id = String(formData.get("id") ?? "");
    if (!id) return { error: "Agenda inválida." };
    // limpa anexos do storage antes de remover (cascade apaga as linhas). Uma
    // agenda de meses tem milhares de logs: fetchAll pelo teto de 1000 e o
    // `.in()` em lotes pela URL, senão os arquivos ficavam órfãos no storage
    const { data: logsDaAgenda } = await fetchAll(() => ctx.supabase.from("agenda_logs").select("id").eq("agenda_id", id).order("id"));
    const { data: atts } = await emLotes((logsDaAgenda ?? []).map((l) => l.id), (lote) =>
      ctx.supabase.from("agenda_log_attachments").select("path").in("log_id", lote));
    const paths = (atts ?? []).map((a) => a.path);
    if (paths.length) { const rm = await ctx.supabase.storage.from(BUCKET).remove(paths); if (rm.error) console.error("agenda att cleanup:", rm.error.message); }
    const { error } = await ctx.supabase.from("agendas").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

// ---------- Demandas não previstas (atalho do diário de bordo) ----------
//
// Não entram na agenda da rotina: ela é do gestor, e o colaborador só escreve
// nela quando o gestor libera. Cada pessoa ganha, no primeiro uso, uma agenda
// própria marcada com `imprevistos`, e cada demanda vira uma tarefa de data
// única lá dentro. Assim herda tudo do diário (status, observação, anexos,
// histórico) sem regra de permissão nova: a dona da agenda é a própria pessoa.

const NOME_AGENDA_IMPREVISTOS = "Demandas não previstas";
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
/** a mesma janela que o diário carrega: antes disso o status nem apareceria */
const DIAS_PARA_TRAS = 90;

/** A agenda de demandas não previstas de quem está logado, criada no primeiro uso. */
async function agendaDeImprevistos(ctx: Ctx): Promise<{ id: string } | { error: string }> {
  const buscar = () => ctx.supabase.from("agendas").select("id, active")
    .eq("tenant_id", ctx.tenantId).eq("responsible_id", ctx.userId).eq("imprevistos", true).maybeSingle();

  let { data: ag } = await buscar();
  if (!ag) {
    const { error } = await ctx.supabase.from("agendas").insert({
      tenant_id: ctx.tenantId,
      unit_id: null, // aparece em qualquer recorte de unidade, como a pessoa
      name: NOME_AGENDA_IMPREVISTOS,
      description: "Demandas que surgiram fora da rotina, registradas pelo atalho do diário de bordo.",
      owner_id: ctx.userId,
      responsible_id: ctx.userId,
      can_responsible_edit: true,
      imprevistos: true,
      created_by: ctx.userId,
    });
    // 23505: outro clique criou no mesmo instante (índice único por pessoa)
    if (error && error.code !== "23505") return { error: error.message };
    ({ data: ag } = await buscar());
    if (!ag) return { error: "Não foi possível preparar a agenda de demandas não previstas." };
  }
  // inativada à mão: registrar uma demanda nova é pedir para ela voltar a valer
  if (!ag.active) {
    const { error } = await ctx.supabase.from("agendas")
      .update({ active: true, updated_at: new Date().toISOString() }).eq("id", ag.id);
    if (error) return { error: error.message };
  }
  return { id: ag.id };
}

export type DemandaNaoPrevistaInput = {
  title: string;
  description?: string | null;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  duration_minutes: number;
};

export async function registrarDemandaNaoPrevista(input: DemandaNaoPrevistaInput): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const title = (input.title ?? "").trim();
    if (!title) return { error: "Descreva a demanda que surgiu." };
    if (title.length > 200) return { error: "O título passou de 200 caracteres. Detalhe na descrição." };
    if (!RE_DATA.test(input.date ?? "") || Number.isNaN(Date.parse(`${input.date}T12:00:00`))) {
      return { error: "Informe a data da demanda." };
    }
    const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    const limite = new Date(`${hoje}T12:00:00`);
    limite.setDate(limite.getDate() - DIAS_PARA_TRAS);
    if (input.date < limite.toLocaleDateString("sv-SE")) {
      return { error: `A data pode voltar no máximo ${DIAS_PARA_TRAS} dias.` };
    }
    if (!RE_HORA.test(input.time ?? "")) return { error: "Informe o horário em que a demanda começou." };
    const duracao = Math.round(Number(input.duration_minutes));
    if (!Number.isFinite(duracao) || duracao < 5 || duracao > 720) {
      return { error: "Informe a duração em minutos, de 5 a 720." };
    }

    const ag = await agendaDeImprevistos(ctx);
    if ("error" in ag) return { error: ag.error };

    const { error } = await ctx.supabase.from("agenda_tasks").insert({
      tenant_id: ctx.tenantId,
      agenda_id: ag.id,
      title,
      description: clean(input.description),
      scheduled_time: input.time,
      duration_minutes: duracao,
      frequency: "unica",
      weekdays: [],
      day_of_month: null,
      fixed_date: input.date,
      // vale no dia da própria demanda, mesmo registrada para trás
      vigente_de: input.date,
      sort: 0,
      active: true,
      flexible: false,
    });
    if (error) return { error: error.message };
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Exclui uma demanda não prevista registrada por engano (só dessas: rotina se edita na agenda). */
export async function excluirDemandaNaoPrevista(taskId: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { data: t } = await ctx.supabase.from("agenda_tasks").select("id, agenda_id").eq("id", taskId).maybeSingle();
    if (!t) return { error: "Demanda não encontrada." };
    const { data: ag } = await ctx.supabase.from("agendas").select("imprevistos").eq("id", t.agenda_id).maybeSingle();
    if (!ag?.imprevistos) return { error: "Por aqui só se excluem demandas não previstas. Tarefas da rotina se editam na agenda." };

    // anexos saem do storage antes: o cascade apaga só as linhas
    const { data: logs } = await ctx.supabase.from("agenda_logs").select("id").eq("task_id", taskId);
    const logIds = (logs ?? []).map((l) => l.id);
    if (logIds.length) {
      const { data: atts } = await ctx.supabase.from("agenda_log_attachments").select("path").in("log_id", logIds);
      const paths = (atts ?? []).map((a) => a.path);
      if (paths.length) { const rm = await ctx.supabase.storage.from(BUCKET).remove(paths); if (rm.error) console.error("agenda att cleanup:", rm.error.message); }
    }

    const { data: apagadas, error } = await ctx.supabase.from("agenda_tasks").delete().eq("id", taskId).select("id");
    if (error) return { error: error.message };
    // a RLS recusa em silêncio (zero linhas), sem erro
    if (!apagadas?.length) return { error: "Você não tem permissão para excluir esta demanda." };
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
