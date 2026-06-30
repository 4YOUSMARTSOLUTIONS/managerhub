"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

function isAdminRole(role: Enums<"member_role">) {
  return role === "owner" || role === "admin";
}

export type CreateAreaGoalInput = {
  department_id?: string | null;
  name: string;
  unit?: string;
  kind: Enums<"area_goal_kind">;
  direction: Enums<"goal_direction">;
  consolidation: Enums<"area_consolidation">;
  owner_id?: string | null;
};

export async function createAreaGoal(input: CreateAreaGoalInput): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem cadastrar indicadores." };
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome do indicador." };

    const { error } = await supabase.from("area_goals").insert({
      tenant_id: tenantId,
      department_id: input.department_id || null,
      name,
      unit: (input.unit ?? "").trim(),
      kind: input.kind,
      direction: input.direction,
      consolidation: input.consolidation,
      owner_id: input.owner_id || null,
      created_by: userId,
    });
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type UpdateAreaGoalInput = {
  id: string;
  department_id?: string | null;
  name: string;
  unit?: string;
  kind: Enums<"area_goal_kind">;
  direction: Enums<"goal_direction">;
  consolidation: Enums<"area_consolidation">;
  owner_id?: string | null;
};

export async function updateAreaGoal(input: UpdateAreaGoalInput): Promise<ActionState> {
  try {
    const { supabase, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem editar indicadores." };
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome do indicador." };
    const { error } = await supabase
      .from("area_goals")
      .update({
        department_id: input.department_id || null,
        name,
        unit: (input.unit ?? "").trim(),
        kind: input.kind,
        direction: input.direction,
        consolidation: input.consolidation,
        owner_id: input.owner_id || null,
      })
      .eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteAreaGoal(id: string): Promise<ActionState> {
  try {
    const { supabase, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem excluir indicadores." };
    const { error } = await supabase.from("area_goals").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type UpsertAreaEntryInput = {
  area_goal_id: string;
  unit_id: string | null; // null = Grupo (consolidação manual)
  period: string; // YYYY-MM-01
  target_value: number | null;
  actual_value: number | null;
};

export async function upsertAreaEntry(input: UpsertAreaEntryInput): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    if (!input.area_goal_id) return { error: "Indicador inválido." };
    if (!input.period) return { error: "Informe a competência." };
    const num = (v: number | null) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

    // upsert manual por (area_goal_id, period, unit_id) — RLS garante permissão (owner/admin ou responsável)
    let sel = supabase
      .from("area_goal_entries")
      .select("id")
      .eq("area_goal_id", input.area_goal_id)
      .eq("period", input.period);
    sel = input.unit_id === null ? sel.is("unit_id", null) : sel.eq("unit_id", input.unit_id);
    const { data: existing } = await sel.maybeSingle();

    const payload = {
      tenant_id: tenantId,
      area_goal_id: input.area_goal_id,
      unit_id: input.unit_id,
      period: input.period,
      target_value: num(input.target_value),
      actual_value: num(input.actual_value),
    };

    let error;
    if (existing?.id) {
      ({ error } = await supabase.from("area_goal_entries").update(payload).eq("id", existing.id));
    } else {
      ({ error } = await supabase.from("area_goal_entries").insert(payload));
    }
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteAreaEntry(input: { area_goal_id: string; unit_id: string | null; period: string }): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    let q = supabase.from("area_goal_entries").delete().eq("area_goal_id", input.area_goal_id).eq("period", input.period);
    q = input.unit_id === null ? q.is("unit_id", null) : q.eq("unit_id", input.unit_id);
    const { error } = await q;
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
