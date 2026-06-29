"use client";

import { Section } from "@/components/ui/Section";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { deleteMeeting } from "@/lib/actions/meetings";
import { MEETING_STATUS, MEETING_STATUS_TONE } from "@/lib/constants";
import { formatDateTime, formatTime } from "@/lib/format";
import type { CalMeeting, View } from "./RoomCalendar";
import type { Enums } from "@/types/database";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
const mondayOf = (d: Date) => addDays(startOfDay(d), -(((d.getDay() + 6) % 7)));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fShort = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

function periodRange(view: View, cursor: Date): [Date, Date, string] {
  if (view === "day") {
    const s = startOfDay(cursor);
    return [s, addDays(s, 1), cap(cursor.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" }))];
  }
  if (view === "week") {
    const s = mondayOf(cursor);
    const e = addDays(s, 7);
    return [s, e, `${fShort(s)} – ${fShort(addDays(s, 6))}`];
  }
  const s = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const e = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  return [s, e, cap(cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }))];
}

const plural = (n: number) => (n === 1 ? `${n} reunião` : `${n} reuniões`);

export function MeetingsTable({
  meetings,
  roomFilter,
  view,
  cursor,
  userId,
  role,
  onEdit,
}: {
  meetings: CalMeeting[];
  roomFilter: string;
  view: View;
  cursor: Date;
  userId: string;
  role: Enums<"member_role">;
  onEdit: (m: CalMeeting) => void;
}) {
  const isAdmin = role === "owner" || role === "admin";
  const [start, end, periodLabel] = periodRange(view, cursor);

  const rows = meetings
    .filter((m) => roomFilter === "all" || m.room?.id === roomFilter)
    .filter((m) => {
      const t = new Date(m.starts_at);
      return t >= start && t < end;
    })
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));

  return (
    <Section title={`${plural(rows.length)} · ${periodLabel}`} padded={false}>
      {rows.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Reunião</th>
              <th>Sala</th>
              <th>Quando</th>
              <th>Agendado por</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const canManage = isAdmin || m.created_by === userId;
              return (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.title}</td>
                  <td>
                    {m.room ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                        <span style={{ width: 9, height: 9, borderRadius: 3, background: m.room.color }} />
                        {m.room.name}
                      </span>
                    ) : <span className="soft">—</span>}
                  </td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>
                    {formatDateTime(m.starts_at)} <span className="soft">→ {formatTime(m.ends_at)}</span>
                  </td>
                  <td>
                    {m.creatorName ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
                        <Avatar name={m.creatorName} />
                        <span className="muted" style={{ fontSize: "0.85rem" }}>{m.creatorName}</span>
                      </span>
                    ) : <span className="soft">—</span>}
                  </td>
                  <td>
                    <Badge tone={MEETING_STATUS_TONE[m.status]}>{MEETING_STATUS[m.status]}</Badge>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {canManage ? (
                      <div style={{ display: "inline-flex", gap: "0.4rem", justifyContent: "flex-end" }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(m)}>Editar</button>
                        <form action={deleteMeeting} style={{ display: "inline" }}>
                          <input type="hidden" name="id" value={m.id} />
                          <button className="btn btn-danger btn-sm" type="submit">Excluir</button>
                        </form>
                      </div>
                    ) : (
                      <span className="soft" style={{ fontSize: "0.78rem" }} title="Apenas o criador, admin ou owner">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <EmptyState
          title="Nenhuma reunião no período"
          description={roomFilter === "all" ? "Ajuste o período ou agende uma reunião." : "Nenhuma reunião para essa sala no período selecionado."}
        />
      )}
    </Section>
  );
}
