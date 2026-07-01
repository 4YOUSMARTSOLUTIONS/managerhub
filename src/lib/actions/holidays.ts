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

export type HolidayImportRow = { day: string; name: string };

/** Importação em lote (planilha .xlsx). O parse do arquivo é feito no cliente;
 *  aqui só validamos e gravamos (upsert por data). */
export async function importHolidays(
  rows: HolidayImportRow[],
): Promise<{ imported: number; skipped: number; error?: string }> {
  try {
    const { supabase, tenantId } = await actionContext();
    const seen = new Set<string>();
    const valid: { tenant_id: string; day: string; name: string }[] = [];
    for (const r of rows ?? []) {
      const day = String(r?.day ?? "").trim();
      const name = String(r?.name ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !name) continue;
      if (seen.has(day)) continue;
      seen.add(day);
      valid.push({ tenant_id: tenantId, day, name });
    }
    const skipped = (rows?.length ?? 0) - valid.length;
    if (valid.length === 0) return { imported: 0, skipped, error: "Nenhuma linha válida — verifique as colunas Data e Nome." };

    const { error } = await supabase.from("holidays").upsert(valid, { onConflict: "tenant_id,day" });
    if (error) return { imported: 0, skipped, error: error.message };

    revalidatePath("/configuracoes");
    revalidatePath("/salas");
    return { imported: valid.length, skipped };
  } catch (e) {
    return { imported: 0, skipped: 0, error: (e as Error).message };
  }
}
