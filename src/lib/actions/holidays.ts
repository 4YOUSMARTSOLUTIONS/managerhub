"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";

// A RLS (holidays_admin_write) garante que só owner/admin/manager gravam.
export async function createHoliday(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    const day = String(formData.get("day") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    if (!day) return { error: "Informe a data do feriado." };
    if (!name) return { error: "Informe o nome do feriado." };

    const { error } = await supabase
      .from("holidays")
      .upsert({ tenant_id: tenantId, day, name }, { onConflict: "tenant_id,day" });
    if (error) return { error: error.message };

    revalidatePath("/configuracoes");
    revalidatePath("/salas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteHoliday(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("holidays").delete().eq("id", String(formData.get("id")));
  revalidatePath("/configuracoes");
  revalidatePath("/salas");
}
