"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import {
  dispatchInvite, dispatchSeriesInvite, dispatchOccurrenceOverride, type InviteResult,
} from "@/lib/invites";
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
    const { supabase } = await actionContext();

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

    // insert atômico (reunião + participantes) validando sala/série/participantes
    // contra o tenant — sem "reunião fantasma" e sem IDs de outro tenant.
    const { data: meetingId, error } = await supabase.rpc("create_meeting", {
      p_data: {
        title,
        description: String(formData.get("description") ?? "").trim() || null,
        room_id,
        series_id,
        participants,
        starts_at: starts,
        ends_at: ends,
      },
    });
    if (error) return { error: error.message };

    const invite = await dispatchInvite(meetingId as string, "REQUEST", { bump: false, label: "Convite de reunião" });

    revalidatePath("/salas");
    revalidatePath("/dashboard");
    return invite === "failed"
      ? { ok: true, warning: "Reunião agendada, mas o convite por e-mail não pôde ser enviado. Verifique a integração (Resend) em Configurações." }
      : { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updateMeeting(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    const id = String(formData.get("id") ?? "");
    if (!id) return { error: "Reunião inválida." };

    const title = String(formData.get("title") ?? "").trim();
    if (!title) return { error: "Informe o título da reunião." };

    const starts = localToISO(String(formData.get("starts_at") ?? ""));
    const ends = localToISO(String(formData.get("ends_at") ?? ""));
    if (!starts || !ends) return { error: "Informe início e fim." };
    if (new Date(ends) <= new Date(starts)) return { error: "O fim deve ser depois do início." };

    let room_id = String(formData.get("room_id") ?? "") || null;
    let series_id = String(formData.get("series_id") ?? "") || null;

    let participants: string[] = [];
    try {
      participants = JSON.parse(String(formData.get("participants") ?? "[]")) as string[];
    } catch {
      participants = [];
    }
    if (participants.length === 0) return { error: "Selecione ao menos um participante." };

    // valida referências/participantes contra o tenant (não aceita IDs de outro tenant)
    if (room_id) {
      const { data } = await supabase.from("rooms").select("id").eq("id", room_id).eq("tenant_id", tenantId).maybeSingle();
      if (!data) room_id = null;
    }
    if (series_id) {
      const { data } = await supabase.from("meeting_series").select("id").eq("id", series_id).eq("tenant_id", tenantId).is("deleted_at", null).maybeSingle();
      if (!data) series_id = null;
    }
    {
      const { data } = await supabase.from("memberships").select("user_id").eq("tenant_id", tenantId).in("user_id", participants);
      const ok = new Set((data ?? []).map((m) => m.user_id));
      participants = participants.filter((p) => ok.has(p));
      if (participants.length === 0) return { error: "Selecione ao menos um participante válido." };
    }

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
      // editar uma ocorrência de série a "destaca": a renovação automática
      // passa a respeitar a alteração (não move de volta nem duplica).
      ...(series_id ? { series_detached: true } : {}),
    }).eq("id", id);

    if (error) {
      if (error.code === "23P01") return { error: "Essa sala já está reservada nesse horário." };
      return { error: error.message };
    }

    // ocorrência gerada por série (auto-reserva) tem convite tratado como override
    const { data: mrow } = await supabase.from("meetings").select("series_slot").eq("id", id).maybeSingle();
    const isSeriesOcc = !!mrow?.series_slot;

    let invite: InviteResult = "skipped";
    // cancelamento de reunião avulsa: avisa quem TINHA a reunião (antes de trocar participantes)
    if (status === "cancelled" && !isSeriesOcc) {
      invite = await dispatchInvite(id, "CANCEL", { bump: true, label: "Reunião cancelada" });
    }

    // substitui os participantes
    await supabase.from("meeting_participants").delete().eq("meeting_id", id);
    const { error: pErr } = await supabase.from("meeting_participants").insert(participants.map((uid) => ({ meeting_id: id, user_id: uid })));
    if (pErr) return { error: "Não foi possível salvar os participantes. Tente novamente." };

    if (isSeriesOcc) {
      // move/cancela UMA ocorrência da série → override RECURRENCE-ID no Outlook
      invite = await dispatchOccurrenceOverride(id, status === "cancelled" ? "CANCEL" : "REQUEST");
    } else if (status !== "cancelled") {
      invite = await dispatchInvite(id, "REQUEST", { bump: true, label: "Reunião atualizada" });
    }

    revalidatePath("/salas");
    revalidatePath("/dashboard");
    return invite === "failed"
      ? { ok: true, warning: "Reunião salva, mas o convite/atualização por e-mail não pôde ser enviado." }
      : { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setMeetingStatus(formData: FormData): Promise<ActionState> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as Enums<"meeting_status">;
  // .select() confirma que a linha é do tenant (RLS) antes de acionar o e-mail via service-role
  const { data: updated, error } = await supabase.from("meetings").update({ status }).eq("id", id).select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) return { error: "Reunião não encontrada ou sem permissão." };
  if (status === "cancelled") await dispatchInvite(id, "CANCEL", { bump: true, label: "Reunião cancelada" });
  revalidatePath("/salas");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteMeeting(formData: FormData): Promise<ActionState> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));

  // leitura via RLS confirma a posse antes de qualquer ação com service-role
  const { data: m } = await supabase.from("meetings").select("series_slot").eq("id", id).maybeSingle();
  if (!m) return { error: "Reunião não encontrada ou sem permissão." };

  // Ocorrência gerada por uma série: não apaga (a renovação recriaria o dia).
  // Marca como cancelada + destacada — vira uma "lápide" que a série respeita.
  if (m.series_slot) {
    const { error } = await supabase.from("meetings").update({ status: "cancelled", series_detached: true }).eq("id", id);
    if (error) return { error: error.message };
    // remove essa ocorrência do convite recorrente no Outlook (RECURRENCE-ID + CANCEL)
    await dispatchOccurrenceOverride(id, "CANCEL");
    revalidatePath("/salas");
    revalidatePath("/dashboard");
    return { ok: true };
  }

  // envia o cancelamento ANTES de excluir (precisa dos participantes)
  await dispatchInvite(id, "CANCEL", { bump: true, label: "Reunião cancelada" });
  const { error } = await supabase.from("meetings").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/salas");
  revalidatePath("/dashboard");
  return { ok: true };
}

