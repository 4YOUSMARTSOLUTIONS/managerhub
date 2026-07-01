"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { createServiceClient } from "@/lib/supabase/admin";
import { buildIcs, type IcsMethod } from "@/lib/ics";
import { sendInvite, ORGANIZER_EMAIL } from "@/lib/mailer";
import { formatDateTime } from "@/lib/format";
import { PERIODICITY } from "@/lib/constants";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

// Data UTC no formato iCalendar (YYYYMMDDTHHMMSSZ), p/ o UNTIL da RRULE.
function toIcsUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

// Mapeia a periodicidade da série para uma RRULE (RFC 5545). null = sem recorrência.
function seriesRrule(periodicity: Enums<"meeting_periodicity">, untilUtc: string): string | null {
  const base: Partial<Record<Enums<"meeting_periodicity">, string>> = {
    diaria: "FREQ=DAILY",
    semanal: "FREQ=WEEKLY",
    quinzenal: "FREQ=WEEKLY;INTERVAL=2",
    mensal: "FREQ=MONTHLY",
    bimestral: "FREQ=MONTHLY;INTERVAL=2",
    trimestral: "FREQ=MONTHLY;INTERVAL=3",
    semestral: "FREQ=MONTHLY;INTERVAL=6",
    anual: "FREQ=YEARLY",
  };
  const rule = base[periodicity];
  return rule ? `${rule};UNTIL=${untilUtc}` : null;
}

// converte datetime-local (hora de Brasília) para ISO com offset fixo -03:00
function localToISO(value: string): string | null {
  if (!value) return null;
  return new Date(`${value}:00-03:00`).toISOString();
}

/**
 * Envia (ou atualiza/cancela) o convite .ics por e-mail aos participantes.
 * Best-effort: qualquer falha é engolida para não quebrar o salvamento da reunião.
 */
async function dispatchInvite(meetingId: string, method: IcsMethod, opts: { bump: boolean; label: string }): Promise<void> {
  try {
    const admin = createServiceClient();
    const { data: m } = await admin
      .from("meetings")
      .select("id, tenant_id, title, description, starts_at, ends_at, ics_sequence, organizer_id, series_id, rooms(name)")
      .eq("id", meetingId)
      .maybeSingle();
    if (!m) return;

    // reuniões geradas por uma série com auto-reserva têm o convite tratado
    // no nível da série (convite recorrente único) — não envia convite avulso.
    const seriesId = (m as unknown as { series_id: string | null }).series_id;
    if (seriesId) {
      const { data: srs } = await admin.from("meeting_series").select("auto_book").eq("id", seriesId).maybeSingle();
      if (srs?.auto_book) return;
    }

    // chave do Resend do tenant (server-only); sem chave, não envia
    const { data: secret } = await admin.from("tenant_secrets").select("resend_api_key").eq("tenant_id", m.tenant_id).maybeSingle();
    const apiKey = secret?.resend_api_key?.trim();
    if (!apiKey) return;

    let seq = m.ics_sequence ?? 0;
    if (opts.bump) {
      seq += 1;
      await admin.from("meetings").update({ ics_sequence: seq }).eq("id", meetingId);
    }

    const { data: org } = m.organizer_id
      ? await admin.from("profiles").select("full_name").eq("id", m.organizer_id).maybeSingle()
      : { data: null };

    const { data: parts } = await admin
      .from("meeting_participants")
      .select("profiles(full_name, email)")
      .eq("meeting_id", meetingId);

    const attendees = (parts ?? [])
      .map((p) => (p as unknown as { profiles: { full_name: string | null; email: string | null } | null }).profiles)
      .filter((pr): pr is { full_name: string | null; email: string } => !!pr?.email)
      .map((pr) => ({ name: pr.full_name ?? pr.email, email: pr.email }));
    if (attendees.length === 0) return;

    const location = (m.rooms as unknown as { name: string } | null)?.name || "Online";
    const organizerName = org?.full_name ?? "MANAGER HUB";

    const ics = buildIcs({
      uid: `${meetingId}@managerhub`,
      sequence: seq,
      method,
      title: m.title,
      description: m.description,
      location,
      start: m.starts_at,
      end: m.ends_at,
      organizerName,
      organizerEmail: ORGANIZER_EMAIL,
      attendees,
    });

    const html =
      `<h2 style="margin:0 0 8px">${opts.label}: ${m.title}</h2>` +
      `<p style="margin:2px 0"><strong>Quando:</strong> ${formatDateTime(m.starts_at)} — ${formatDateTime(m.ends_at)}</p>` +
      `<p style="margin:2px 0"><strong>Local:</strong> ${location}</p>` +
      `<p style="margin:2px 0"><strong>Organizador:</strong> ${organizerName}</p>` +
      (m.description ? `<p style="margin:8px 0 0">${m.description}</p>` : "") +
      `<p style="margin:12px 0 0;color:#6b7280;font-size:12px">Convite enviado pelo MANAGER HUB.</p>`;

    await sendInvite({ apiKey, to: attendees.map((a) => a.email), subject: `${opts.label}: ${m.title}`, html, ics, method });
  } catch (e) {
    console.error("[meetings] dispatchInvite falhou:", (e as Error).message);
  }
}

/**
 * Envia (ou cancela) UM convite recorrente (RRULE) para a série inteira.
 * Best-effort: qualquer falha é engolida. Use "REQUEST" quando a série tem
 * auto-reserva ativa, e "CANCEL" quando a auto-reserva é desligada.
 */
export async function dispatchSeriesInvite(seriesId: string, method: IcsMethod): Promise<void> {
  try {
    const admin = createServiceClient();
    const { data: s } = await admin
      .from("meeting_series")
      .select("id, tenant_id, name, objetivo, periodicity, next_date, start_time, duration_min, duration_unit, ics_sequence, owner_user_id, rooms(name)")
      .eq("id", seriesId)
      .maybeSingle();
    if (!s || !s.next_date || !s.start_time) return;

    // CANCEL só faz sentido se já enviamos algo antes
    if (method === "CANCEL" && (s.ics_sequence ?? 0) === 0) return;

    const { data: secret } = await admin.from("tenant_secrets").select("resend_api_key").eq("tenant_id", s.tenant_id).maybeSingle();
    const apiKey = secret?.resend_api_key?.trim();
    if (!apiKey) return;

    const { data: parts } = await admin
      .from("meeting_series_participants")
      .select("profiles(full_name, email)")
      .eq("series_id", seriesId);

    const attendees = (parts ?? [])
      .map((p) => (p as unknown as { profiles: { full_name: string | null; email: string | null } | null }).profiles)
      .filter((pr): pr is { full_name: string | null; email: string } => !!pr?.email)
      .map((pr) => ({ name: pr.full_name ?? pr.email, email: pr.email }));
    if (attendees.length === 0) return;

    // primeira ocorrência (horário de Brasília, offset fixo -03:00)
    const start = new Date(`${s.next_date}T${s.start_time}-03:00`);
    const durMin = (s.duration_min ?? 60) * (s.duration_unit === "h" ? 60 : 1) || 60;
    const end = new Date(start.getTime() + durMin * 60000);
    // horizonte: diária = 1 mês (evita ~365 ocorrências); demais = 12 meses
    const horizonMonths = s.periodicity === "diaria" ? 1 : 12;
    const until = new Date(start);
    until.setMonth(until.getMonth() + horizonMonths);

    const rrule = method === "CANCEL" ? null : seriesRrule(s.periodicity, toIcsUtc(until));

    const seq = (s.ics_sequence ?? 0) + 1;
    await admin.from("meeting_series").update({ ics_sequence: seq }).eq("id", seriesId);

    const { data: org } = s.owner_user_id
      ? await admin.from("profiles").select("full_name").eq("id", s.owner_user_id).maybeSingle()
      : { data: null };

    const location = (s.rooms as unknown as { name: string } | null)?.name || "Online";
    const organizerName = org?.full_name ?? "MANAGER HUB";
    const label = method === "CANCEL" ? "Série de reuniões cancelada" : "Convite de reunião recorrente";
    const cadence = PERIODICITY[s.periodicity] ?? "Recorrente";

    const ics = buildIcs({
      uid: `series-${seriesId}@managerhub`,
      sequence: seq,
      method,
      title: s.name,
      description: s.objetivo,
      location,
      start: start.toISOString(),
      end: end.toISOString(),
      rrule,
      organizerName,
      organizerEmail: ORGANIZER_EMAIL,
      attendees,
    });

    const html =
      `<h2 style="margin:0 0 8px">${label}: ${s.name}</h2>` +
      (method === "CANCEL"
        ? `<p style="margin:2px 0">A série de reuniões recorrentes foi cancelada.</p>`
        : `<p style="margin:2px 0"><strong>Frequência:</strong> ${cadence}</p>` +
          `<p style="margin:2px 0"><strong>Primeira ocorrência:</strong> ${formatDateTime(start.toISOString())}</p>` +
          `<p style="margin:2px 0"><strong>Local:</strong> ${location}</p>` +
          `<p style="margin:2px 0"><strong>Organizador:</strong> ${organizerName}</p>` +
          (s.objetivo ? `<p style="margin:8px 0 0">${s.objetivo}</p>` : "")) +
      `<p style="margin:12px 0 0;color:#6b7280;font-size:12px">Convite recorrente enviado pelo MANAGER HUB. As ocorrências dos próximos ${horizonMonths === 1 ? "30 dias" : "12 meses"} ficam reservadas.</p>`;

    await sendInvite({ apiKey, to: attendees.map((a) => a.email), subject: `${label}: ${s.name}`, html, ics, method });
  } catch (e) {
    console.error("[meetings] dispatchSeriesInvite falhou:", (e as Error).message);
  }
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

    const { error: pErr } = await supabase.from("meeting_participants").insert(
      participants.map((uid) => ({ meeting_id: meeting.id, user_id: uid })),
    );
    if (pErr) {
      // rollback: não deixa reunião "fantasma" sem participantes
      await supabase.from("meetings").delete().eq("id", meeting.id);
      return { error: "Não foi possível salvar os participantes. Tente novamente." };
    }

    await dispatchInvite(meeting.id, "REQUEST", { bump: false, label: "Convite de reunião" });

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
    const { error: pErr } = await supabase.from("meeting_participants").insert(participants.map((uid) => ({ meeting_id: id, user_id: uid })));
    if (pErr) return { error: "Não foi possível salvar os participantes. Tente novamente." };

    if (status !== "cancelled") {
      await dispatchInvite(id, "REQUEST", { bump: true, label: "Reunião atualizada" });
    } else {
      await dispatchInvite(id, "CANCEL", { bump: true, label: "Reunião cancelada" });
    }

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
  if (status === "cancelled") await dispatchInvite(id, "CANCEL", { bump: true, label: "Reunião cancelada" });
  revalidatePath("/salas");
  revalidatePath("/dashboard");
}

export async function deleteMeeting(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  // envia o cancelamento ANTES de excluir (precisa dos participantes)
  await dispatchInvite(id, "CANCEL", { bump: true, label: "Reunião cancelada" });
  await supabase.from("meetings").delete().eq("id", id);
  revalidatePath("/salas");
  revalidatePath("/dashboard");
}
