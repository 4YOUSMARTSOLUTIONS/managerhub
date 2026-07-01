// Geração de convite iCalendar (RFC 5545) para envio por e-mail.

export type IcsMethod = "REQUEST" | "CANCEL";

export type IcsInput = {
  uid: string;
  sequence: number;
  method: IcsMethod;
  title: string;
  description?: string | null;
  location?: string | null;
  start: string; // ISO
  end: string; // ISO
  rrule?: string | null; // ex.: "FREQ=MONTHLY;INTERVAL=1;UNTIL=20270630T120000Z"
  recurrenceId?: string | null; // ISO do slot original — override de UMA ocorrência da série
  organizerName: string;
  organizerEmail: string;
  attendees: { name: string; email: string }[];
};

/** Escapa texto conforme RFC 5545 (vírgula, ponto-e-vírgula, barra, quebras de linha). */
function esc(v: string): string {
  return String(v)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Data UTC no formato iCalendar: 20260630T143500Z */
function toUtc(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** Dobra linhas longas em até 75 octetos (RFC 5545), continuação com espaço. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(" " + rest);
  return parts.join("\r\n");
}

export function buildIcs(input: IcsInput): string {
  const cancelled = input.method === "CANCEL";
  const stamp = toUtc(new Date().toISOString());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "PRODID:-//MANAGER HUB//Reunioes//PT-BR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toUtc(input.start)}`,
    `DTEND:${toUtc(input.end)}`,
    input.rrule ? `RRULE:${input.rrule}` : "",
    input.recurrenceId ? `RECURRENCE-ID:${toUtc(input.recurrenceId)}` : "",
    `SUMMARY:${esc(input.title)}`,
    input.description ? `DESCRIPTION:${esc(input.description)}` : "",
    input.location ? `LOCATION:${esc(input.location)}` : "",
    `ORGANIZER;CN=${esc(input.organizerName)}:mailto:${input.organizerEmail}`,
    ...input.attendees.map(
      (a) => `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${esc(a.name)}:mailto:${a.email}`,
    ),
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    cancelled ? "" : "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return lines.map(fold).join("\r\n");
}
