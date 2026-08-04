/**
 * Envio dos convites .ics das reuniões.
 *
 * Este módulo NÃO tem "use server" de propósito. Enquanto essas funções viviam em
 * meetings.ts, `dispatchSeriesInvite` precisava ser exportada só para meeting-records.ts
 * poder importá-la — e exportar de um arquivo "use server" a publica como ENDPOINT.
 * Ela abre cliente service role, aceita um seriesId qualquer e dispara convite ou
 * CANCELAMENTO aos participantes, sem verificar sessão, empresa ou papel. Qualquer
 * usuário logado que descobrisse o id da action conseguiria chamá-la.
 *
 * Aqui elas são funções internas de servidor: continuam rodando com service role,
 * mas só alcançáveis por quem já passou pela server action que as chama.
 */

import { createServiceClient } from "@/lib/supabase/admin";
import { getPlatformResend } from "@/lib/platform-integrations";
import { buildIcs, type IcsMethod } from "@/lib/ics";
import { sendInvite, ORGANIZER_EMAIL } from "@/lib/mailer";
import { formatDateTime } from "@/lib/format";
import { PERIODICITY } from "@/lib/constants";
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

// Resultado do envio: enviado, falhou (havia o que enviar mas não saiu), ou
// pulado (nada a enviar: sem chave, sem participante com e-mail, série auto).
export type InviteResult = "sent" | "failed" | "skipped";

function escapeHtml(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Envia (ou atualiza/cancela) o convite .ics por e-mail aos participantes.
 * Retorna o status para o chamador poder avisar o usuário se o envio falhar.
 * Nunca lança — qualquer erro vira "failed".
 */
export async function dispatchInvite(meetingId: string, method: IcsMethod, opts: { bump: boolean; label: string }): Promise<InviteResult> {
  try {
    const admin = createServiceClient();
    const { data: m } = await admin
      .from("meetings")
      .select("id, tenant_id, title, description, starts_at, ends_at, ics_sequence, organizer_id, series_id, rooms(name)")
      .eq("id", meetingId)
      .maybeSingle();
    if (!m) return "skipped";

    // reuniões geradas por uma série com auto-reserva têm o convite tratado
    // no nível da série (convite recorrente único) — não envia convite avulso.
    const seriesId = (m as unknown as { series_id: string | null }).series_id;
    if (seriesId) {
      const { data: srs } = await admin.from("meeting_series").select("auto_book").eq("id", seriesId).maybeSingle();
      if (srs?.auto_book) return "skipped";
    }

    // chave do Resend do tenant (server-only); sem chave, não envia
    const { apiKey } = await getPlatformResend();
    if (!apiKey) return "skipped";

    const seq = (m.ics_sequence ?? 0) + (opts.bump ? 1 : 0);

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
    if (attendees.length === 0) return "skipped";

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
      `<h2 style="margin:0 0 8px">${escapeHtml(opts.label)}: ${escapeHtml(m.title)}</h2>` +
      `<p style="margin:2px 0"><strong>Quando:</strong> ${formatDateTime(m.starts_at)} — ${formatDateTime(m.ends_at)}</p>` +
      `<p style="margin:2px 0"><strong>Local:</strong> ${escapeHtml(location)}</p>` +
      `<p style="margin:2px 0"><strong>Organizador:</strong> ${escapeHtml(organizerName)}</p>` +
      (m.description ? `<p style="margin:8px 0 0">${escapeHtml(m.description)}</p>` : "") +
      `<p style="margin:12px 0 0;color:#6b7280;font-size:12px">Convite enviado pelo MANAGER HUB.</p>`;

    const ok = await sendInvite({ apiKey, to: attendees.map((a) => a.email), subject: `${opts.label}: ${m.title}`, html, ics, method });
    // só grava a nova sequência se o envio deu certo (evita drift de SEQUENCE)
    if (ok && opts.bump) {
      await admin.from("meetings").update({ ics_sequence: seq }).eq("id", meetingId);
    }
    return ok ? "sent" : "failed";
  } catch (e) {
    console.error("[meetings] dispatchInvite falhou:", (e as Error).message);
    return "failed";
  }
}

/**
 * Envia (ou cancela) UM convite recorrente (RRULE) para a série inteira.
 * Best-effort: qualquer falha é engolida. Use "REQUEST" quando a série tem
 * auto-reserva ativa, e "CANCEL" quando a auto-reserva é desligada.
 */
export async function dispatchSeriesInvite(seriesId: string, method: IcsMethod): Promise<InviteResult> {
  try {
    const admin = createServiceClient();
    const { data: s } = await admin
      .from("meeting_series")
      .select("id, tenant_id, name, objetivo, periodicity, next_date, start_time, duration_min, duration_unit, ics_sequence, owner_user_id, rooms(name)")
      .eq("id", seriesId)
      .maybeSingle();
    if (!s || !s.next_date || !s.start_time) return "skipped";

    // CANCEL só faz sentido se já enviamos algo antes
    if (method === "CANCEL" && (s.ics_sequence ?? 0) === 0) return "skipped";

    const { apiKey } = await getPlatformResend();
    if (!apiKey) return "skipped";

    const { data: parts } = await admin
      .from("meeting_series_participants")
      .select("profiles(full_name, email)")
      .eq("series_id", seriesId);

    const attendees = (parts ?? [])
      .map((p) => (p as unknown as { profiles: { full_name: string | null; email: string | null } | null }).profiles)
      .filter((pr): pr is { full_name: string | null; email: string } => !!pr?.email)
      .map((pr) => ({ name: pr.full_name ?? pr.email, email: pr.email }));
    if (attendees.length === 0) return "skipped";

    // primeira ocorrência (horário de Brasília, offset fixo -03:00)
    const start = new Date(`${s.next_date}T${s.start_time}-03:00`);
    const durMin = (s.duration_min ?? 60) * (s.duration_unit === "h" ? 60 : 1) || 60;
    const end = new Date(start.getTime() + durMin * 60000);
    // horizonte: diária = 1 mês (evita ~365 ocorrências); demais = 12 meses
    const horizonMonths = s.periodicity === "diaria" ? 1 : 12;
    const until = new Date(start);
    until.setUTCMonth(until.getUTCMonth() + horizonMonths); // UTC-safe

    const rrule = method === "CANCEL" ? null : seriesRrule(s.periodicity, toIcsUtc(until));

    const seq = (s.ics_sequence ?? 0) + 1;

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
      `<h2 style="margin:0 0 8px">${escapeHtml(label)}: ${escapeHtml(s.name)}</h2>` +
      (method === "CANCEL"
        ? `<p style="margin:2px 0">A série de reuniões recorrentes foi cancelada.</p>`
        : `<p style="margin:2px 0"><strong>Frequência:</strong> ${escapeHtml(cadence)}</p>` +
          `<p style="margin:2px 0"><strong>Primeira ocorrência:</strong> ${formatDateTime(start.toISOString())}</p>` +
          `<p style="margin:2px 0"><strong>Local:</strong> ${escapeHtml(location)}</p>` +
          `<p style="margin:2px 0"><strong>Organizador:</strong> ${escapeHtml(organizerName)}</p>` +
          (s.objetivo ? `<p style="margin:8px 0 0">${escapeHtml(s.objetivo)}</p>` : "")) +
      `<p style="margin:12px 0 0;color:#6b7280;font-size:12px">Convite recorrente enviado pelo MANAGER HUB. As ocorrências dos próximos ${horizonMonths === 1 ? "30 dias" : "12 meses"} ficam reservadas.</p>`;

    const ok = await sendInvite({ apiKey, to: attendees.map((a) => a.email), subject: `${label}: ${s.name}`, html, ics, method });
    if (ok) {
      await admin.from("meeting_series").update({ ics_sequence: seq }).eq("id", seriesId);
    }
    return ok ? "sent" : "failed";
  } catch (e) {
    console.error("[meetings] dispatchSeriesInvite falhou:", (e as Error).message);
    return "failed";
  }
}

/**
 * Override de UMA ocorrência de uma série com auto-reserva no convite recorrente
 * do Outlook (VEVENT com RECURRENCE-ID = slot original). Mantém a série sincronizada
 * quando o usuário move/cancela uma ocorrência isolada.
 */
export async function dispatchOccurrenceOverride(meetingId: string, method: IcsMethod): Promise<InviteResult> {
  try {
    const admin = createServiceClient();
    const { data: m } = await admin
      .from("meetings")
      .select("id, tenant_id, title, description, starts_at, ends_at, series_id, series_slot, rooms(name)")
      .eq("id", meetingId)
      .maybeSingle();
    if (!m || !m.series_id || !m.series_slot) return "skipped";

    const { data: s } = await admin.from("meeting_series").select("auto_book, ics_sequence, owner_user_id").eq("id", m.series_id).maybeSingle();
    if (!s?.auto_book) return "skipped";

    const { apiKey } = await getPlatformResend();
    if (!apiKey) return "skipped";

    const { data: parts } = await admin.from("meeting_series_participants").select("profiles(full_name, email)").eq("series_id", m.series_id);
    const attendees = (parts ?? [])
      .map((p) => (p as unknown as { profiles: { full_name: string | null; email: string | null } | null }).profiles)
      .filter((pr): pr is { full_name: string | null; email: string } => !!pr?.email)
      .map((pr) => ({ name: pr.full_name ?? pr.email, email: pr.email }));
    if (attendees.length === 0) return "skipped";

    const { data: org } = s.owner_user_id
      ? await admin.from("profiles").select("full_name").eq("id", s.owner_user_id).maybeSingle()
      : { data: null };
    const location = (m.rooms as unknown as { name: string } | null)?.name || "Online";
    const organizerName = org?.full_name ?? "MANAGER HUB";
    const seq = (s.ics_sequence ?? 0) + 1;
    const label = method === "CANCEL" ? "Ocorrência cancelada" : "Ocorrência remarcada";

    const ics = buildIcs({
      uid: `series-${m.series_id}@managerhub`,
      sequence: seq,
      method,
      title: m.title,
      description: m.description,
      location,
      start: m.starts_at,
      end: m.ends_at,
      recurrenceId: m.series_slot,
      organizerName,
      organizerEmail: ORGANIZER_EMAIL,
      attendees,
    });

    const html =
      `<h2 style="margin:0 0 8px">${escapeHtml(label)}: ${escapeHtml(m.title)}</h2>` +
      `<p style="margin:2px 0"><strong>Quando:</strong> ${formatDateTime(m.starts_at)} — ${formatDateTime(m.ends_at)}</p>` +
      `<p style="margin:2px 0"><strong>Local:</strong> ${escapeHtml(location)}</p>` +
      `<p style="margin:12px 0 0;color:#6b7280;font-size:12px">Alteração de uma ocorrência da série recorrente (MANAGER HUB).</p>`;

    const ok = await sendInvite({ apiKey, to: attendees.map((a) => a.email), subject: `${label}: ${m.title}`, html, ics, method });
    if (ok) await admin.from("meeting_series").update({ ics_sequence: seq }).eq("id", m.series_id);
    return ok ? "sent" : "failed";
  } catch (e) {
    console.error("[meetings] dispatchOccurrenceOverride falhou:", (e as Error).message);
    return "failed";
  }
}
