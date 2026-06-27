"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

export async function createAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await actionContext();

    const title = String(formData.get("title") ?? "").trim();
    if (!title) return { error: "Informe o título da ação." };

    const { error } = await supabase.from("action_items").insert({
      tenant_id: tenantId,
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      assignee_id: String(formData.get("assignee_id") ?? "") || null,
      meeting_id: String(formData.get("meeting_id") ?? "") || null,
      priority: (String(formData.get("priority") ?? "medium") as Enums<"priority_level">),
      due_date: String(formData.get("due_date") ?? "") || null,
      created_by: userId,
    });
    if (error) return { error: error.message };

    revalidatePath("/acoes");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setActionStatus(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as Enums<"action_status">;
  await supabase
    .from("action_items")
    .update({
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
    })
    .eq("id", id);
  revalidatePath("/acoes");
  revalidatePath("/dashboard");
}

export async function deleteAction(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("action_items").delete().eq("id", String(formData.get("id")));
  revalidatePath("/acoes");
  revalidatePath("/dashboard");
}
