"use server";

import { revalidatePath } from "next/cache";
import { adminActionContext } from "./context";
import type { ActionState } from "./types";

/**
 * A unidade da sala (LUIZ, 25/11/2026): obrigatória ao criar e ao editar, e tem
 * de ser da empresa (o banco confere de novo no gatilho rooms_unidade_da_empresa).
 */
async function unidadeDaSala(
  supabase: Awaited<ReturnType<typeof adminActionContext>>["supabase"],
  tenantId: string,
  formData: FormData,
): Promise<{ unitId: string } | { error: string }> {
  const unitId = String(formData.get("unit_id") ?? "").trim();
  if (!unitId) return { error: "Escolha a unidade da sala." };
  const { data } = await supabase.from("units").select("id").eq("id", unitId).eq("tenant_id", tenantId).maybeSingle();
  if (!data) return { error: "Unidade inválida." };
  return { unitId };
}

export async function createRoom(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();

    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { error: "Informe o nome da sala." };

    const capacityRaw = String(formData.get("capacity") ?? "").trim();
    const capacity = Number(capacityRaw);
    if (!capacityRaw || !Number.isFinite(capacity) || capacity < 1) return { error: "Informe a capacidade da sala (mínimo 1)." };
    const location = String(formData.get("location") ?? "").trim() || null;
    const color = String(formData.get("color") ?? "#2563eb");
    const resources = String(formData.get("resources") ?? "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);

    const unidade = await unidadeDaSala(supabase, tenantId, formData);
    if ("error" in unidade) return { error: unidade.error };

    const { error } = await supabase.from("rooms").insert({
      tenant_id: tenantId,
      unit_id: unidade.unitId,
      name,
      capacity,
      location,
      color,
      resources,
    });
    if (error) return { error: error.message };

    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updateRoom(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();

    const id = String(formData.get("id") ?? "").trim();
    if (!id) return { error: "Sala inválida." };
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { error: "Informe o nome da sala." };

    const capacityRaw = String(formData.get("capacity") ?? "").trim();
    const capacity = Number(capacityRaw);
    if (!capacityRaw || !Number.isFinite(capacity) || capacity < 1) return { error: "Informe a capacidade da sala (mínimo 1)." };
    const location = String(formData.get("location") ?? "").trim() || null;
    const color = String(formData.get("color") ?? "#2563eb");
    const resources = String(formData.get("resources") ?? "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);

    const unidade = await unidadeDaSala(supabase, tenantId, formData);
    if ("error" in unidade) return { error: unidade.error };

    const { error } = await supabase
      .from("rooms")
      .update({ name, capacity, location, color, resources, unit_id: unidade.unitId })
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) return { error: error.message };

    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function toggleRoom(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  const id = String(formData.get("id"));
  const active = String(formData.get("is_active")) === "true";
  await supabase.from("rooms").update({ is_active: !active }).eq("id", id);
  revalidatePath("/configuracoes");
}

export async function deleteRoom(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  const id = String(formData.get("id"));
  await supabase.from("rooms").delete().eq("id", id);
  revalidatePath("/configuracoes");
}
