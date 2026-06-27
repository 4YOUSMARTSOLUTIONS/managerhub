"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";

export async function createRoom(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();

    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { error: "Informe o nome da sala." };

    const capacity = Number(formData.get("capacity") ?? 1) || 1;
    const location = String(formData.get("location") ?? "").trim() || null;
    const color = String(formData.get("color") ?? "#2563eb");
    const resources = String(formData.get("resources") ?? "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);

    const { error } = await supabase.from("rooms").insert({
      tenant_id: tenantId,
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

export async function toggleRoom(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  const active = String(formData.get("is_active")) === "true";
  await supabase.from("rooms").update({ is_active: !active }).eq("id", id);
  revalidatePath("/configuracoes");
}

export async function deleteRoom(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  await supabase.from("rooms").delete().eq("id", id);
  revalidatePath("/configuracoes");
}
