"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import { quadroDe, SO_PARTICIPANTE, type Ctx } from "./planner-shared";
import { posicaoNoFim } from "@/lib/planner-position";
import { recusaDeUpload, TAMANHO_ANEXO, MIMES_ANEXO } from "@/lib/uploads";

/**
 * O interior do cartão: etiquetas, checklist, comentários, anexos e a leitura
 * do detalhe (comentários + histórico, paginados).
 *
 * Tudo aqui abre com `quadroDe` e recusa com erro nomeado ANTES de tocar banco
 * ou storage. A RLS é a rede de baixo, mas ela recusa em silêncio; e no caso do
 * storage a policy é por TENANT (primeiro segmento do path), então o recorte
 * fino — participante do quadro — é exatamente esta guarda.
 */

const RP = "/planner";
const BUCKET = "planner-attachments";
const PAGINA = 30;

/** resolve a tarefa e a alçada numa ida só; null = não existe ou não alcanço */
async function tarefaDe(ctx: Ctx, taskId: string) {
  const { data: task } = await ctx.supabase
    .from("planner_tasks")
    .select("id, board_id, tenant_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return null;
  const { participante } = await quadroDe(ctx, task.board_id);
  return { task, participante };
}

// ---------------------------------------------------------------- etiquetas

const CORES = new Set(["blue", "green", "amber", "red", "purple", "pink", "gray", "dark"]);

export async function createLabel(boardId: string, name: string, color: string): Promise<ActionState & { labelId?: string }> {
  try {
    const ctx = await actionContext();
    const { board, participante } = await quadroDe(ctx, boardId);
    if (!board) return { error: "Quadro não encontrado." };
    if (!participante) return { error: SO_PARTICIPANTE };
    const nome = (name ?? "").trim();
    if (!nome) return { error: "Dê um nome à etiqueta." };
    if (!CORES.has(color)) return { error: "Cor inválida." };
    const { data, error } = await ctx.supabase
      .from("planner_labels")
      .insert({ tenant_id: ctx.tenantId, board_id: boardId, name: nome, color })
      .select("id")
      .single();
    if (error) {
      return { error: error.message.includes("planner_labels_nome_unico") ? "Já existe uma etiqueta com esse nome neste quadro." : error.message };
    }
    revalidatePath(RP);
    return { ok: true, labelId: data.id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteLabel(labelId: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { data: label } = await ctx.supabase
      .from("planner_labels").select("id, board_id").eq("id", labelId).maybeSingle();
    if (!label) return { error: "Etiqueta não encontrada." };
    const { participante } = await quadroDe(ctx, label.board_id);
    if (!participante) return { error: SO_PARTICIPANTE };
    // os vínculos caem pelo cascade; a etiqueta some de todos os cartões
    const { error } = await ctx.supabase.from("planner_labels").delete().eq("id", labelId);
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** o conjunto de etiquetas do cartão vira exatamente `labelIds` */
export async function setTaskLabels(taskId: string, labelIds: string[]): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const alvo = await tarefaDe(ctx, taskId);
    if (!alvo) return { error: "Tarefa não encontrada." };
    if (!alvo.participante) return { error: SO_PARTICIPANTE };

    const ids = [...new Set(labelIds)];
    // etiqueta é do QUADRO: um id de outro quadro seria contrabando
    if (ids.length) {
      const { data: validas } = await ctx.supabase
        .from("planner_labels").select("id").eq("board_id", alvo.task.board_id).in("id", ids);
      if ((validas ?? []).length !== ids.length) return { error: "Há etiqueta que não é deste quadro." };
    }

    const { error: eDel } = await ctx.supabase.from("planner_task_labels").delete().eq("task_id", taskId);
    if (eDel) return { error: eDel.message };
    if (ids.length) {
      const { error: eIns } = await ctx.supabase.from("planner_task_labels").insert(
        ids.map((label_id) => ({ task_id: taskId, label_id, tenant_id: ctx.tenantId, board_id: alvo.task.board_id })),
      );
      if (eIns) return { error: eIns.message };
    }
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------- checklist

export async function addChecklistItem(taskId: string, title: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const alvo = await tarefaDe(ctx, taskId);
    if (!alvo) return { error: "Tarefa não encontrada." };
    if (!alvo.participante) return { error: SO_PARTICIPANTE };
    const texto = (title ?? "").trim();
    if (!texto) return { error: "Escreva o item." };
    const { data: irmaos } = await ctx.supabase
      .from("planner_checklist_items").select("position").eq("task_id", taskId);
    const { error } = await ctx.supabase.from("planner_checklist_items").insert({
      tenant_id: ctx.tenantId, board_id: alvo.task.board_id, task_id: taskId,
      title: texto, position: posicaoNoFim((irmaos ?? []).map((i) => i.position)),
    });
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** guarda comum dos itens: acha o item, resolve a alçada pelo quadro */
async function itemDe(ctx: Ctx, itemId: string) {
  const { data: item } = await ctx.supabase
    .from("planner_checklist_items").select("id, board_id, task_id").eq("id", itemId).maybeSingle();
  if (!item) return null;
  const { participante } = await quadroDe(ctx, item.board_id);
  return { item, participante };
}

export async function toggleChecklistItem(itemId: string, done: boolean): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const alvo = await itemDe(ctx, itemId);
    if (!alvo) return { error: "Item não encontrado." };
    if (!alvo.participante) return { error: SO_PARTICIPANTE };
    const { error } = await ctx.supabase.from("planner_checklist_items").update({ done }).eq("id", itemId);
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function renameChecklistItem(itemId: string, title: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const texto = (title ?? "").trim();
    if (!texto) return { error: "Escreva o item." };
    const alvo = await itemDe(ctx, itemId);
    if (!alvo) return { error: "Item não encontrado." };
    if (!alvo.participante) return { error: SO_PARTICIPANTE };
    const { error } = await ctx.supabase.from("planner_checklist_items").update({ title: texto }).eq("id", itemId);
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteChecklistItem(itemId: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const alvo = await itemDe(ctx, itemId);
    if (!alvo) return { error: "Item não encontrado." };
    if (!alvo.participante) return { error: SO_PARTICIPANTE };
    const { error } = await ctx.supabase.from("planner_checklist_items").delete().eq("id", itemId);
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// --------------------------------------------------------------- comentários

export async function addTaskComment(taskId: string, body: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const alvo = await tarefaDe(ctx, taskId);
    if (!alvo) return { error: "Tarefa não encontrada." };
    if (!alvo.participante) return { error: SO_PARTICIPANTE };
    const texto = (body ?? "").trim();
    if (!texto) return { error: "Escreva o comentário." };
    const { error } = await ctx.supabase.from("planner_task_comments").insert({
      tenant_id: ctx.tenantId, board_id: alvo.task.board_id, task_id: taskId,
      author_id: ctx.userId, body: texto,
    });
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteTaskComment(commentId: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    // a RLS já só deixa o autor apagar; a checagem aqui é para o erro ter nome
    const { data: c } = await ctx.supabase
      .from("planner_task_comments").select("id, author_id").eq("id", commentId).maybeSingle();
    if (!c) return { error: "Comentário não encontrado." };
    if (c.author_id !== ctx.userId) return { error: "Só o autor pode apagar o próprio comentário." };
    const { error } = await ctx.supabase.from("planner_task_comments").delete().eq("id", commentId);
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ------------------------------------------------------------------- anexos

export async function uploadTaskAttachment(formData: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const taskId = String(formData.get("task_id") ?? "");
    const alvo = await tarefaDe(ctx, taskId);
    if (!alvo) return { error: "Tarefa não encontrada." };
    if (!alvo.participante) return { error: SO_PARTICIPANTE };

    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return { error: "Escolha um arquivo." };
    for (const f of files) {
      const recusa = recusaDeUpload(f, TAMANHO_ANEXO, MIMES_ANEXO);
      if (recusa) return { error: recusa };
    }

    for (const file of files) {
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${ctx.tenantId}/${taskId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
      const up = await ctx.supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (up.error) return { error: up.error.message };
      const { error } = await ctx.supabase.from("planner_task_attachments").insert({
        tenant_id: ctx.tenantId, board_id: alvo.task.board_id, task_id: taskId,
        file_path: path, file_name: file.name, mime_type: file.type || null,
        size_bytes: file.size, uploaded_by: ctx.userId,
      });
      if (error) {
        // linha não entrou: o arquivo órfão sai do storage para não virar lixo invisível
        await ctx.supabase.storage.from(BUCKET).remove([path]);
        return { error: error.message };
      }
    }
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteTaskAttachment(attachmentId: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { data: att } = await ctx.supabase
      .from("planner_task_attachments").select("id, board_id, file_path").eq("id", attachmentId).maybeSingle();
    if (!att) return { error: "Anexo não encontrado." };
    const { participante } = await quadroDe(ctx, att.board_id);
    if (!participante) return { error: SO_PARTICIPANTE };
    const rm = await ctx.supabase.storage.from(BUCKET).remove([att.file_path]);
    if (rm.error) console.error("planner anexo cleanup:", rm.error.message);
    const { error } = await ctx.supabase.from("planner_task_attachments").delete().eq("id", attachmentId);
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function getTaskAttachmentUrl(attachmentId: string): Promise<string | null> {
  const ctx = await actionContext();
  const { data: att } = await ctx.supabase
    .from("planner_task_attachments").select("file_path").eq("id", attachmentId).maybeSingle();
  if (!att) return null; // a RLS já cortou quem não vê o quadro
  const { data } = await ctx.supabase.storage.from(BUCKET).createSignedUrl(att.file_path, 60 * 10);
  return data?.signedUrl ?? null;
}

// ------------------------------------------------------------------ detalhe

export type TaskComment = { id: string; authorId: string; authorName: string; body: string; createdAt: string };
export type TaskEvent = { id: string; actorId: string | null; actorName: string; type: string; meta: Record<string, unknown>; createdAt: string };
export type TaskAttachment = { id: string; fileName: string; sizeBytes: number | null; createdAt: string };

/**
 * Comentários e histórico do cartão, paginados (30 de cada, mais recentes
 * primeiro). Carregado SÓ quando o diálogo abre: descer isso com o quadro
 * multiplicaria a página por cartão sem ninguém ter pedido.
 */
export async function getTaskDetail(taskId: string, opts?: { beforeComment?: string; beforeEvent?: string }): Promise<{
  comments: TaskComment[]; events: TaskEvent[]; attachments: TaskAttachment[];
  hasMoreComments: boolean; hasMoreEvents: boolean;
} | { error: string }> {
  try {
    const ctx = await actionContext();
    // leitura: basta VER o quadro; a RLS das duas tabelas já responde isso,
    // então aqui não há guarda de participante
    let qc = ctx.supabase
      .from("planner_task_comments")
      .select("id, author_id, body, created_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(PAGINA + 1);
    if (opts?.beforeComment) qc = qc.lt("created_at", opts.beforeComment);
    let qe = ctx.supabase
      .from("planner_task_events")
      .select("id, actor_id, type, meta, created_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(PAGINA + 1);
    if (opts?.beforeEvent) qe = qe.lt("created_at", opts.beforeEvent);

    const [{ data: comments }, { data: events }, { data: atts }] = await Promise.all([
      qc, qe,
      ctx.supabase
        .from("planner_task_attachments")
        .select("id, file_name, size_bytes, created_at")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false }),
    ]);

    const ids = [...new Set([
      ...(comments ?? []).map((c) => c.author_id),
      ...(events ?? []).map((e) => e.actor_id).filter((x): x is string => !!x),
    ])];
    const nomes = new Map<string, string>();
    if (ids.length) {
      const { data: perfis } = await ctx.supabase.from("profiles").select("id, full_name").in("id", ids);
      for (const p of perfis ?? []) nomes.set(p.id, p.full_name ?? "—");
    }

    const cs = (comments ?? []).slice(0, PAGINA).map((c) => ({
      id: c.id, authorId: c.author_id, authorName: nomes.get(c.author_id) ?? "—",
      body: c.body, createdAt: c.created_at,
    }));
    const es = (events ?? []).slice(0, PAGINA).map((e) => ({
      id: e.id, actorId: e.actor_id, actorName: e.actor_id ? nomes.get(e.actor_id) ?? "—" : "Sistema",
      type: e.type, meta: (e.meta ?? {}) as Record<string, unknown>, createdAt: e.created_at,
    }));
    return {
      comments: cs, events: es,
      attachments: (atts ?? []).map((a) => ({ id: a.id, fileName: a.file_name, sizeBytes: a.size_bytes, createdAt: a.created_at })),
      hasMoreComments: (comments ?? []).length > PAGINA,
      hasMoreEvents: (events ?? []).length > PAGINA,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
