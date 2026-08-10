/**
 * O que as DUAS famílias de actions do Planner (`planner.ts` e
 * `planner-detail.ts`) compartilham.
 *
 * Este arquivo NÃO leva `"use server"` de propósito: módulo com essa diretiva
 * só pode exportar função assíncrona, e cada export vira endpoint público.
 * `quadroDe` é guarda interna, não endpoint.
 */

import { actionContext } from "./context";
import type { Json } from "@/types/database";

export type Ctx = Awaited<ReturnType<typeof actionContext>>;

export const SEM_QUADRO = "Quadro não encontrado.";
export const SO_DONO = "Apenas o dono do quadro ou um administrador pode fazer isso.";
export const SO_PARTICIPANTE = "Você não participa deste quadro nem gerencia alguém que participe.";

/**
 * O quadro com a resposta às duas perguntas de alçada.
 *
 * `dono` = gere o quadro (renomear, excluir, convidar): o criador ou um
 * admin/owner da empresa. `participante` = edita o conteúdo: além dos de cima,
 * os convidados e o GESTOR de qualquer participante. A pergunta do gestor é
 * respondida pela MESMA função que a RLS usa (`my_planner_board_ids`), para a
 * tela e o banco nunca discordarem sobre quem pode.
 */
export async function quadroDe(ctx: Ctx, boardId: string) {
  const { data: board } = await ctx.supabase
    .from("planner_boards")
    .select("id, tenant_id, created_by")
    .eq("id", boardId)
    .maybeSingle();
  if (!board) return { board: null, dono: false, participante: false };
  const dono = board.created_by === ctx.userId || ctx.role === "owner" || ctx.role === "admin";
  if (dono) return { board, dono, participante: true };
  const { data: escrita } = await ctx.supabase.rpc("my_planner_board_ids");
  const participante = ((escrita as unknown as string[] | null) ?? []).includes(boardId);
  return { board, dono, participante };
}

export type PlannerEventType =
  | "created" | "moved_bucket" | "progress_changed"
  | "assigned" | "unassigned" | "due_changed" | "moved_board";

/**
 * Uma linha no histórico do cartão. Best-effort DE PROPÓSITO: o histórico
 * nunca pode ser o motivo de um salvamento falhar, então o erro é engolido
 * com log no servidor.
 */
export async function registrarEvento(
  ctx: Ctx,
  task: { id: string; board_id: string },
  type: PlannerEventType,
  meta: Json = {},
): Promise<void> {
  const { error } = await ctx.supabase.from("planner_task_events").insert({
    tenant_id: ctx.tenantId,
    board_id: task.board_id,
    task_id: task.id,
    actor_id: ctx.userId,
    type,
    meta,
  });
  if (error) console.error("planner evento:", type, error.message);
}
