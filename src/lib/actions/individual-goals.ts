"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

function isAdminRole(role: Enums<"member_role">) {
  return role === "owner" || role === "admin";
}

export type CreateGoalInput = {
  name: string;
  description?: string;
  unit?: string;
  direction: Enums<"goal_direction">;
  owner_id?: string;
};

export type CreateGoalResult = { ok: true; id: string } | { error: string };

export async function createIndividualGoal(input: CreateGoalInput): Promise<CreateGoalResult> {
  try {
    const { supabase, tenantId, userId, role } = await actionContext();
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome da meta." };
    const owner_id = isAdminRole(role) ? input.owner_id || userId : userId;

    const { data, error } = await supabase
      .from("individual_goals")
      .insert({
        tenant_id: tenantId,
        owner_id,
        name,
        description: (input.description ?? "").trim() || null,
        unit: (input.unit ?? "").trim(),
        direction: input.direction,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };

    revalidatePath("/metas");
    return { ok: true, id: data.id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type UpdateGoalInput = {
  id: string;
  name: string;
  description?: string;
  unit?: string;
  direction: Enums<"goal_direction">;
};

export async function updateIndividualGoal(input: UpdateGoalInput): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome da meta." };
    const { error } = await supabase
      .from("individual_goals")
      .update({
        name,
        description: (input.description ?? "").trim() || null,
        unit: (input.unit ?? "").trim(),
        direction: input.direction,
      })
      .eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteIndividualGoal(id: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.from("individual_goals").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type UpsertEntryInput = {
  goal_id: string;
  period: string; // YYYY-MM-01 (competência)
  target_value: number;
  actual_value: number | null;
  weight?: number;
  note?: string;
};

export async function upsertGoalEntry(input: UpsertEntryInput): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await actionContext();
    if (!input.goal_id) return { error: "Meta inválida." };
    if (!input.period) return { error: "Informe a competência." };
    if (input.target_value == null || Number.isNaN(Number(input.target_value))) {
      return { error: "Informe a meta do período." };
    }
    const actual =
      input.actual_value == null || Number.isNaN(Number(input.actual_value)) ? null : Number(input.actual_value);

    const { error } = await supabase.from("individual_goal_entries").upsert(
      {
        tenant_id: tenantId,
        goal_id: input.goal_id,
        period: input.period,
        target_value: Number(input.target_value),
        actual_value: actual,
        weight: Math.max(0, Number(input.weight) || 0),
        note: (input.note ?? "").trim() || null,
        created_by: userId,
      },
      { onConflict: "goal_id,period" },
    );
    if (error) return { error: error.message };

    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteGoalEntry(input: { goal_id: string; period: string }): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase
      .from("individual_goal_entries")
      .delete()
      .eq("goal_id", input.goal_id)
      .eq("period", input.period);
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Distribui os pesos das metas de UMA competência (a soma deve ser 100%). */
export async function setEntryWeights(input: { period: string; weights: { goal_id: string; weight: number }[] }): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const weights = input.weights ?? [];
    if (!input.period) return { error: "Competência inválida." };
    if (weights.length === 0) return { error: "Nenhuma meta para distribuir." };
    const total = Math.round(weights.reduce((s, w) => s + (Number(w.weight) || 0), 0));
    if (total !== 100) return { error: `A soma dos pesos deve ser 100% (atual: ${total}%).` };
    for (const w of weights) {
      const { error } = await supabase
        .from("individual_goal_entries")
        .update({ weight: Math.max(0, Number(w.weight) || 0) })
        .eq("goal_id", w.goal_id)
        .eq("period", input.period);
      if (error) return { error: error.message };
    }
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
