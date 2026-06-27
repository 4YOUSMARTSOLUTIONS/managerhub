"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

export async function createTicket(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await actionContext();

    const title = String(formData.get("title") ?? "").trim();
    if (!title) return { error: "Informe o título do chamado." };

    const { error } = await supabase.from("tickets").insert({
      tenant_id: tenantId,
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      category: (String(formData.get("category") ?? "outros") as Enums<"ticket_category">),
      priority: (String(formData.get("priority") ?? "medium") as Enums<"priority_level">),
      assignee_id: String(formData.get("assignee_id") ?? "") || null,
      due_date: String(formData.get("due_date") ?? "") || null,
      requester_id: userId,
      created_by: userId,
    });
    if (error) return { error: error.message };

    revalidatePath("/chamados");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setTicketStatus(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as Enums<"ticket_status">;
  const done = status === "resolved" || status === "closed";
  await supabase
    .from("tickets")
    .update({ status, resolved_at: done ? new Date().toISOString() : null })
    .eq("id", id);
  revalidatePath("/chamados");
  revalidatePath("/dashboard");
}

export async function deleteTicket(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("tickets").delete().eq("id", String(formData.get("id")));
  revalidatePath("/chamados");
  revalidatePath("/dashboard");
}
