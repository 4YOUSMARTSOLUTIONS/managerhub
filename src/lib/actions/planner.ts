"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";
import { posicaoNoFim, posicaoEntre, renormalizar } from "@/lib/planner-position";
import { quadroDe, SEM_QUADRO, SO_DONO, SO_PARTICIPANTE, type Ctx } from "./planner-shared";

/**
 * Planner: quadros, colunas e cartões.
 *
 * A RLS já divide os três círculos (dono, participante, visível), mas ela
 * recusa EM SILÊNCIO: um update fora da policy afeta zero linha e volta sem
 * erro. Por isso toda action confere a alçada antes e devolve erro com nome,
 * que é o que aparece no toast.
 *
 * Duas decisões que não estão no banco:
 *
 * - Excluir coluna com cartões é RECUSADO, nunca cascata: um clique errado não
 *   pode levar dez cartões junto. Mova-os antes.
 * - A posição é calculada AQUI, nunca recebida do navegador: o cliente manda
 *   "depois de qual item" e o servidor decide o número, com a mesma conta do
 *   estado otimista (`planner-position.ts`).
 */

const RP = "/planner";

// ------------------------------------------------------------------ quadros

export async function createBoard(input: { name: string; description?: string; memberIds?: string[] }): Promise<ActionState & { boardId?: string }> {
  try {
    const ctx = await actionContext();
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Dê um nome ao quadro." };

    const { data: board, error } = await ctx.supabase
      .from("planner_boards")
      .insert({ tenant_id: ctx.tenantId, name, description: (input.description ?? "").trim() || null, created_by: ctx.userId })
      .select("id")
      .single();
    if (error) return { error: error.message };

    const membros = [...new Set(input.memberIds ?? [])].filter((id) => id && id !== ctx.userId);
    if (membros.length) {
      const { error: eM } = await ctx.supabase.from("planner_board_members").insert(
        membros.map((user_id) => ({ board_id: board.id, user_id, tenant_id: ctx.tenantId, added_by: ctx.userId })),
      );
      if (eM) return { error: eM.message };
    }

    // o quadro nasce utilizável: as três colunas clássicas já esperando cartão,
    // em vez de uma tela vazia pedindo que a pessoa invente a estrutura
    const { error: eB } = await ctx.supabase.from("planner_buckets").insert([
      { tenant_id: ctx.tenantId, board_id: board.id, name: "A fazer", position: 1024 },
      { tenant_id: ctx.tenantId, board_id: board.id, name: "Em andamento", position: 2048 },
      { tenant_id: ctx.tenantId, board_id: board.id, name: "Concluído", position: 3072 },
    ]);
    if (eB) return { error: eB.message };

    revalidatePath(RP);
    return { ok: true, boardId: board.id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updateBoard(input: { boardId: string; name: string; description?: string }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { board, dono } = await quadroDe(ctx, input.boardId);
    if (!board) return { error: SEM_QUADRO };
    if (!dono) return { error: SO_DONO };
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Dê um nome ao quadro." };
    const { error } = await ctx.supabase
      .from("planner_boards")
      .update({ name, description: (input.description ?? "").trim() || null })
      .eq("id", input.boardId);
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteBoard(boardId: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { board, dono } = await quadroDe(ctx, boardId);
    if (!board) return { error: SEM_QUADRO };
    if (!dono) return { error: SO_DONO };
    // colunas, cartões e convites caem pelo on delete cascade; a confirmação
    // com o nome do quadro acontece na tela, antes de chegar aqui
    const { error } = await ctx.supabase.from("planner_boards").delete().eq("id", boardId);
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** A lista de convidados vira exatamente `userIds`: quem saiu, sai; quem entrou, entra. */
export async function setBoardMembers(boardId: string, userIds: string[]): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { board, dono } = await quadroDe(ctx, boardId);
    if (!board) return { error: SEM_QUADRO };
    if (!dono) return { error: SO_DONO };

    const alvo = [...new Set(userIds)].filter((id) => id && id !== ctx.userId);
    // só gente DESTA empresa pode ser convidada: a RLS confere o tenant da
    // linha, mas o tenant vem daqui, e o id poderia ser de outra empresa
    if (alvo.length) {
      const { data: vinculos } = await ctx.supabase
        .from("memberships").select("user_id").eq("tenant_id", ctx.tenantId).in("user_id", alvo);
      if ((vinculos ?? []).length !== alvo.length) return { error: "Há convidado que não pertence a esta empresa." };
    }

    const { data: atuais } = await ctx.supabase
      .from("planner_board_members").select("user_id").eq("board_id", boardId);
    const jaTem = new Set((atuais ?? []).map((m) => m.user_id));
    const entrar = alvo.filter((id) => !jaTem.has(id));
    const sair = [...jaTem].filter((id) => !alvo.includes(id));

    if (sair.length) {
      const { error } = await ctx.supabase
        .from("planner_board_members").delete().eq("board_id", boardId).in("user_id", sair);
      if (error) return { error: error.message };
    }
    if (entrar.length) {
      const { error } = await ctx.supabase.from("planner_board_members").insert(
        entrar.map((user_id) => ({ board_id: boardId, user_id, tenant_id: ctx.tenantId, added_by: ctx.userId })),
      );
      if (error) return { error: error.message };
    }
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ------------------------------------------------------------------ colunas

export async function createBucket(boardId: string, name: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { board, participante } = await quadroDe(ctx, boardId);
    if (!board) return { error: SEM_QUADRO };
    if (!participante) return { error: SO_PARTICIPANTE };
    const nome = (name ?? "").trim();
    if (!nome) return { error: "Dê um nome à coluna." };

    const { data: irmas } = await ctx.supabase
      .from("planner_buckets").select("position").eq("board_id", boardId);
    const { error } = await ctx.supabase.from("planner_buckets").insert({
      tenant_id: ctx.tenantId, board_id: boardId, name: nome,
      position: posicaoNoFim((irmas ?? []).map((b) => b.position)),
    });
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function renameBucket(bucketId: string, name: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const nome = (name ?? "").trim();
    if (!nome) return { error: "Dê um nome à coluna." };
    const { data: bucket } = await ctx.supabase
      .from("planner_buckets").select("id, board_id").eq("id", bucketId).maybeSingle();
    if (!bucket) return { error: "Coluna não encontrada." };
    const { participante } = await quadroDe(ctx, bucket.board_id);
    if (!participante) return { error: SO_PARTICIPANTE };
    const { error } = await ctx.supabase.from("planner_buckets").update({ name: nome }).eq("id", bucketId);
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteBucket(bucketId: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { data: bucket } = await ctx.supabase
      .from("planner_buckets").select("id, board_id").eq("id", bucketId).maybeSingle();
    if (!bucket) return { error: "Coluna não encontrada." };
    const { participante } = await quadroDe(ctx, bucket.board_id);
    if (!participante) return { error: SO_PARTICIPANTE };

    const { count } = await ctx.supabase
      .from("planner_tasks").select("id", { count: "exact", head: true }).eq("bucket_id", bucketId);
    if ((count ?? 0) > 0) {
      return { error: "A coluna tem cartões. Mova-os para outra coluna antes de excluir." };
    }
    const { error } = await ctx.supabase.from("planner_buckets").delete().eq("id", bucketId);
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function moveBucket(bucketId: string, afterBucketId: string | null): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { data: bucket } = await ctx.supabase
      .from("planner_buckets").select("id, board_id").eq("id", bucketId).maybeSingle();
    if (!bucket) return { error: "Coluna não encontrada." };
    const { participante } = await quadroDe(ctx, bucket.board_id);
    if (!participante) return { error: SO_PARTICIPANTE };

    const { data: irmas } = await ctx.supabase
      .from("planner_buckets").select("id, position").eq("board_id", bucket.board_id).order("position");
    const pos = await posicionar(
      ctx, "planner_buckets", (irmas ?? []).filter((b) => b.id !== bucketId), afterBucketId,
    );
    if (pos.error) return { error: pos.error };
    const { error } = await ctx.supabase.from("planner_buckets").update({ position: pos.position }).eq("id", bucketId);
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ------------------------------------------------------------------ cartões

export type TaskInput = {
  title: string;
  description?: string | null;
  due_date?: string | null;
  priority?: Enums<"priority_level"> | null;
  assigneeIds?: string[];
};

/** valida e normaliza os campos do cartão; devolve erro de tela quando não dá */
function camposDoCartao(input: TaskInput): { error: string } | {
  title: string; description: string | null; due_date: string | null; priority: Enums<"priority_level"> | null;
} {
  const title = (input.title ?? "").trim();
  if (!title) return { error: "Dê um título à tarefa." };
  const due = (input.due_date ?? "")?.trim() || null;
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { error: "Prazo inválido." };
  return {
    title,
    description: (input.description ?? "")?.trim() || null,
    due_date: due,
    priority: input.priority ?? null,
  };
}

/** os responsáveis do cartão precisam PARTICIPAR do quadro; devolve o erro, se houver */
async function conferirAssignees(ctx: Ctx, boardId: string, criadorDoQuadro: string, ids: string[]): Promise<string | null> {
  const fora = ids.filter((id) => id !== criadorDoQuadro);
  if (fora.length === 0) return null;
  const { data: membros } = await ctx.supabase
    .from("planner_board_members").select("user_id").eq("board_id", boardId).in("user_id", fora);
  return (membros ?? []).length === fora.length
    ? null
    : "Só participantes do quadro podem ser responsáveis pela tarefa.";
}

export async function createTask(bucketId: string, input: TaskInput): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { data: bucket } = await ctx.supabase
      .from("planner_buckets").select("id, board_id").eq("id", bucketId).maybeSingle();
    if (!bucket) return { error: "Coluna não encontrada." };
    const { board, participante } = await quadroDe(ctx, bucket.board_id);
    if (!board) return { error: SEM_QUADRO };
    if (!participante) return { error: SO_PARTICIPANTE };

    const campos = camposDoCartao(input);
    if ("error" in campos) return campos;

    const assignees = [...new Set(input.assigneeIds ?? [])];
    const erroA = await conferirAssignees(ctx, board.id, board.created_by, assignees);
    if (erroA) return { error: erroA };

    const { data: irmas } = await ctx.supabase
      .from("planner_tasks").select("position").eq("bucket_id", bucketId);
    const { data: task, error } = await ctx.supabase
      .from("planner_tasks")
      .insert({
        tenant_id: ctx.tenantId, board_id: bucket.board_id, bucket_id: bucketId,
        ...campos, position: posicaoNoFim((irmas ?? []).map((t) => t.position)), created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };

    if (assignees.length) {
      const { error: eA } = await ctx.supabase.from("planner_task_assignees").insert(
        assignees.map((user_id) => ({ task_id: task.id, user_id, tenant_id: ctx.tenantId, board_id: bucket.board_id })),
      );
      if (eA) return { error: eA.message };
    }
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updateTask(taskId: string, input: TaskInput): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { data: task } = await ctx.supabase
      .from("planner_tasks").select("id, board_id").eq("id", taskId).maybeSingle();
    if (!task) return { error: "Tarefa não encontrada." };
    const { board, participante } = await quadroDe(ctx, task.board_id);
    if (!board) return { error: SEM_QUADRO };
    if (!participante) return { error: SO_PARTICIPANTE };

    const campos = camposDoCartao(input);
    if ("error" in campos) return campos;

    const { error } = await ctx.supabase.from("planner_tasks").update(campos).eq("id", taskId);
    if (error) return { error: error.message };

    // a lista de responsáveis vira exatamente a enviada, quando enviada
    if (input.assigneeIds) {
      const assignees = [...new Set(input.assigneeIds)];
      const erroA = await conferirAssignees(ctx, board.id, board.created_by, assignees);
      if (erroA) return { error: erroA };
      const { error: eDel } = await ctx.supabase.from("planner_task_assignees").delete().eq("task_id", taskId);
      if (eDel) return { error: eDel.message };
      if (assignees.length) {
        const { error: eIns } = await ctx.supabase.from("planner_task_assignees").insert(
          assignees.map((user_id) => ({ task_id: taskId, user_id, tenant_id: ctx.tenantId, board_id: task.board_id })),
        );
        if (eIns) return { error: eIns.message };
      }
    }
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteTask(taskId: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { data: task } = await ctx.supabase
      .from("planner_tasks").select("id, board_id").eq("id", taskId).maybeSingle();
    if (!task) return { error: "Tarefa não encontrada." };
    const { participante } = await quadroDe(ctx, task.board_id);
    if (!participante) return { error: SO_PARTICIPANTE };
    const { error } = await ctx.supabase.from("planner_tasks").delete().eq("id", taskId);
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** o risco no cartão: feito/não feito, independente da coluna em que ele está */
export async function toggleTaskComplete(taskId: string, done: boolean): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { data: task } = await ctx.supabase
      .from("planner_tasks").select("id, board_id").eq("id", taskId).maybeSingle();
    if (!task) return { error: "Tarefa não encontrada." };
    const { participante } = await quadroDe(ctx, task.board_id);
    if (!participante) return { error: SO_PARTICIPANTE };
    const { error } = await ctx.supabase
      .from("planner_tasks")
      .update({ completed_at: done ? new Date().toISOString() : null })
      .eq("id", taskId);
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * O arraste. O cliente diz PARA ONDE (coluna) e DEPOIS DE QUEM; o número da
 * posição é decidido aqui, com renormalização quando o vão acaba.
 */
export async function moveTask(taskId: string, toBucketId: string, afterTaskId: string | null): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { data: task } = await ctx.supabase
      .from("planner_tasks").select("id, board_id").eq("id", taskId).maybeSingle();
    if (!task) return { error: "Tarefa não encontrada." };
    const { participante } = await quadroDe(ctx, task.board_id);
    if (!participante) return { error: SO_PARTICIPANTE };

    // a coluna de destino tem de ser do MESMO quadro: cartão não migra de
    // quadro pelo arraste, e um id de fora seria contrabando
    const { data: destino } = await ctx.supabase
      .from("planner_buckets").select("id, board_id").eq("id", toBucketId).maybeSingle();
    if (!destino || destino.board_id !== task.board_id) return { error: "Coluna de destino inválida." };

    const { data: irmas } = await ctx.supabase
      .from("planner_tasks").select("id, position").eq("bucket_id", toBucketId).order("position");
    const pos = await posicionar(
      ctx, "planner_tasks", (irmas ?? []).filter((t) => t.id !== taskId), afterTaskId,
    );
    if (pos.error) return { error: pos.error };

    const { error } = await ctx.supabase
      .from("planner_tasks")
      .update({ bucket_id: toBucketId, position: pos.position })
      .eq("id", taskId);
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Resolve a posição "depois de X" numa lista de irmãos, renormalizando a lista
 * quando o ponto médio colide. Serve para cartões e colunas: a conta é a mesma.
 */
async function posicionar(
  ctx: Ctx,
  tabela: "planner_tasks" | "planner_buckets",
  irmaos: { id: string; position: number }[],
  afterId: string | null,
): Promise<{ position: number; error?: undefined } | { error: string; position?: undefined }> {
  const calcular = (lista: { id: string; position: number }[]): number | null => {
    if (afterId == null) {
      // primeiro da lista
      return posicaoEntre(null, lista[0]?.position ?? null);
    }
    const i = lista.findIndex((x) => x.id === afterId);
    if (i === -1) return posicaoNoFim(lista.map((x) => x.position));
    return posicaoEntre(lista[i].position, lista[i + 1]?.position ?? null);
  };

  let lista = [...irmaos].sort((a, b) => a.position - b.position);
  let pos = calcular(lista);
  if (pos == null) {
    // o vão acabou: reescreve as posições da lista e tenta de novo
    const novas = renormalizar(lista);
    for (const n of novas) {
      const { error } = await ctx.supabase.from(tabela).update({ position: n.position }).eq("id", n.id);
      if (error) return { error: error.message };
    }
    lista = novas;
    pos = calcular(lista);
    if (pos == null) return { error: "Não foi possível calcular a posição. Recarregue e tente de novo." };
  }
  return { position: pos };
}
