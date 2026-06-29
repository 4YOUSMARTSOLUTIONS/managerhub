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
    const series_id = String(formData.get("series_id") ?? "") || null;

    let participants: string[] = [];
    try {
      participants = JSON.parse(String(formData.get("participants") ?? "[]")) as string[];
    } catch {
      participants = [];
    }
    if (participants.length === 0) return { error: "Selecione ao menos um participante." };

    const { data: meeting, error } = await supabase.from("meetings").insert({
      tenant_id: tenantId,
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      room_id,
      series_id,
      organizer_id: userId,
      created_by: userId,
      starts_at: starts,
      ends_at: ends,
    }).select("id").single();

    if (error) {
      if (error.code === "23P01")
        return { error: "Essa sala já está reservada nesse horário." };
      return { error: error.message };
    }

    if (meeting && participants.length > 0) {
      await supabase.from("meeting_participants").insert(
        participants.map((uid) => ({ meeting_id: meeting.id, user_id: uid })),
      );
    }

    revalidatePath("/salas");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updateMeeting(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const id = String(formData.get("id") ?? "");
    if (!id) return { error: "Reunião inválida." };

    const title = String(formData.get("title") ?? "").trim();
    if (!title) return { error: "Informe o título da reunião." };

    const starts = localToISO(String(formData.get("starts_at") ?? ""));
    const ends = localToISO(String(formData.get("ends_at") ?? ""));
    if (!starts || !ends) return { error: "Informe início e fim." };
    if (new Date(ends) <= new Date(starts)) return { error: "O fim deve ser depois do início." };

    const room_id = String(formData.get("room_id") ?? "") || null;
    const series_id = String(formData.get("series_id") ?? "") || null;

    let participants: string[] = [];
    try {
      participants = JSON.parse(String(formData.get("participants") ?? "[]")) as string[];
    } catch {
      participants = [];
    }
    if (participants.length === 0) return { error: "Selecione ao menos um participante." };

    const statusRaw = String(formData.get("status") ?? "");
    const validStatus: Enums<"meeting_status">[] = ["scheduled", "in_progress", "done", "cancelled"];
    const status = validStatus.includes(statusRaw as Enums<"meeting_status">) ? (statusRaw as Enums<"meeting_status">) : undefined;

    const { error } = await supabase.from("meetings").update({
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      room_id,
      series_id,
      starts_at: starts,
      ends_at: ends,
      ...(status ? { status } : {}),
    }).eq("id", id);

    if (error) {
      if (error.code === "23P01") return { error: "Essa sala já está reservada nesse horário." };
      return { error: error.message };
    }

    // substitui os participantes
    await supabase.from("meeting_participants").delete().eq("meeting_id", id);
    await supabase.from("meeting_participants").insert(participants.map((uid) => ({ meeting_id: id, user_id: uid })));

    revalidatePath("/salas");
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
  revalidatePath("/salas");
  revalidatePath("/dashboard");
}

export async function deleteMeeting(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  await supabase.from("meetings").delete().eq("id", id);
  revalidatePath("/salas");
  revalidatePath("/dashboard");
}
