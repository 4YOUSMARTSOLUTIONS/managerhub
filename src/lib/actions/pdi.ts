"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

function isAdminRole(role: Enums<"member_role">) {
  return role === "owner" || role === "admin";
}

type Ctx = { supabase: SupabaseClient<Database>; tenantId: string; userId: string; role: Enums<"member_role"> };

/** true se o usuário atual gerencia o colaborador (admin ou gestor direto). */
async function canManageOwner(ctx: Ctx, ownerId: string): Promise<boolean> {
  if (isAdminRole(ctx.role)) return true;
  if (!ownerId || ownerId === ctx.userId) return false;
  const { data } = await ctx.supabase
    .from("memberships").select("user_id")
    .eq("tenant_id", ctx.tenantId).eq("user_id", ownerId).eq("manager_id", ctx.userId).maybeSingle();
  return !!data;
}

export async function createPdiAction(input: {
  subject_user_id: string; title: string; description?: string | null; due_date?: string | null; source_feedback_id?: string | null;
}): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const title = (input.title ?? "").trim();
    if (!input.subject_user_id) return { error: "Selecione o colaborador." };
    if (!title) return { error: "Informe o título da ação." };
    if (!(await canManageOwner(ctx, input.subject_user_id))) {
      return { error: "Apenas o gestor do colaborador pode criar ações de PDI." };
    }
    const { error } = await ctx.supabase.from("pdi_actions").insert({
      tenant_id: ctx.tenantId,
      subject_user_id: input.subject_user_id,
      created_by: ctx.userId,
      source_feedback_id: input.source_feedback_id || null,
      title,
      description: (input.description ?? "").trim() || null,
      due_date: input.due_date || null,
    });
    if (error) return { error: error.message };
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updatePdiAction(input: { id: string; title: string; description?: string | null; due_date?: string | null }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const title = (input.title ?? "").trim();
    if (!title) return { error: "Informe o título da ação." };
    const { error } = await ctx.supabase.from("pdi_actions").update({
      title, description: (input.description ?? "").trim() || null, due_date: input.due_date || null, updated_at: new Date().toISOString(),
    }).eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deletePdiAction(id: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { error } = await ctx.supabase.from("pdi_actions").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Muda o status. Concluir/cancelar exige gestor/admin (reforçado por trigger); o colaborador pode
 *  mover para em_andamento e solicitar conclusão. */
export async function setPdiStatus(input: { id: string; status: Enums<"pdi_action_status"> }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { data: action } = await ctx.supabase
      .from("pdi_actions").select("subject_user_id, status").eq("id", input.id).maybeSingle();
    if (!action) return { error: "Ação não encontrada." };
    const isManager = await canManageOwner(ctx, action.subject_user_id);
    const isOwnerSubject = action.subject_user_id === ctx.userId;

    if (input.status === "concluida" || input.status === "cancelada") {
      if (!isManager) return { error: "Apenas o gestor pode concluir ou cancelar. Solicite a conclusão." };
    } else if (!isManager && !isOwnerSubject) {
      return { error: "Sem permissão para alterar esta ação." };
    }
    const patch: Database["public"]["Tables"]["pdi_actions"]["Update"] = { status: input.status, updated_at: new Date().toISOString() };
    if (input.status === "concluida") { patch.completed_at = new Date().toISOString(); patch.completed_by = ctx.userId; }
    else { patch.completed_at = null; patch.completed_by = null; }
    const { error } = await ctx.supabase.from("pdi_actions").update(patch).eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function addPdiComment(input: { action_id: string; body: string }): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const body = (input.body ?? "").trim();
    if (!body) return { error: "Escreva um comentário." };
    const { error } = await ctx.supabase.from("pdi_action_comments").insert({
      tenant_id: ctx.tenantId, action_id: input.action_id, author_id: ctx.userId, body,
    });
    if (error) return { error: error.message };
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deletePdiComment(id: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { error } = await ctx.supabase.from("pdi_action_comments").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/feedbacks");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
