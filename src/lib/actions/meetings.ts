"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

// converte datetime-local (hora de Brasília) para ISO com offset fixo -03:00
function localToISO(value: string): string | null {
  if (!value) return null;
  return new Date(`${value}:00-03:00`).toISOString();
}

export async function createMeeting(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await actionContext();

    const title = String(formData.get("title") ?? "").trim();
    if (!title) return { error: "Informe o título da reunião." };

    const starts = localToISO(String(formData.get("starts_at") ?? ""));
    const ends = localToISO(String(formData.get("ends_at") ?? ""));
    if (!starts || !ends) return { error: "Informe início e fim." };
    if (new Date(ends) <= new Date(starts))
      return { error: "O fim deve ser depois do início." };

    const room_id = String(formData.get("room_id") ?? "") || null;

    const { error } = await supabase.from("meetings").insert({
      tenant_id: tenantId,
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      room_id,
      organizer_id: userId,
      created_by: userId,
      starts_at: starts,
      ends_at: ends,
    });

    if (error) {
      if (error.code === "23P01")
        return { error: "Essa sala já está reservada nesse horário." };
      return { error: error.message };
    }

    revalidatePath("/reunioes");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setMeetingStatus(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as Enums<"meeting_status">;
  await supabase.from("meetings").update({ status }).eq("id", id);
  revalidatePath("/reunioes");
  revalidatePath("/dashboard");
}

export async function deleteMeeting(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  await supabase.from("meetings").delete().eq("id", id);
  revalidatePath("/reunioes");
  revalidatePath("/dashboard");
}
