"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

export async function createGoal(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await actionContext();

    const title = String(formData.get("title") ?? "").trim();
    if (!title) return { error: "Informe o título da meta." };

    const { error } = await supabase.from("goals").insert({
      tenant_id: tenantId,
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      owner_id: String(formData.get("owner_id") ?? "") || null,
      unit: String(formData.get("unit") ?? "").trim(),
      target_value: Number(formData.get("target_value") ?? 0) || 0,
      current_value: Number(formData.get("current_value") ?? 0) || 0,
      period_start: String(formData.get("period_start") ?? "") || null,
      period_end: String(formData.get("period_end") ?? "") || null,
      created_by: userId,
    });
    if (error) return { error: error.message };

    revalidatePath("/metas");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function addGoalUpdate(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, userId } = await actionContext();
    const goal_id = String(formData.get("goal_id"));
    const value = Number(formData.get("value"));
    if (Number.isNaN(value)) return { error: "Informe um valor numérico." };

    const { error } = await supabase.from("goal_updates").insert({
      goal_id,
      value,
      note: String(formData.get("note") ?? "").trim() || null,
      created_by: userId,
    });
    if (error) return { error: error.message };

    revalidatePath("/metas");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setGoalStatus(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as Enums<"goal_status">;
  await supabase.from("goals").update({ status }).eq("id", id);
  revalidatePath("/metas");
  revalidatePath("/dashboard");
}

export async function deleteGoal(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("goals").delete().eq("id", String(formData.get("id")));
  revalidatePath("/metas");
  revalidatePath("/dashboard");
}
