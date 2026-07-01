"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MEETING_STATUS, MEETING_STATUS_TONE } from "@/lib/constants";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { deleteMeeting } from "@/lib/actions/meetings";
import { holidayName, isSunday } from "@/lib/holidays";
import type { Prefill } from "./NewMeetingDialog";

export type CalRoom = { id: string; name: string; color: string };
export type CalMeeting = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  status: keyof typeof MEETING_STATUS;
  room: CalRoom | null;
  created_by: string | null;
  creatorName: string | null;
  seriesId: string | null;
  participantIds: string[];
  startInput: string;
  endInput: string;
};

export type View = "month" | "week" | "day";

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const HOUR_PX = 48;
const DEFAULT_COLOR = "#6b7280";
const DEFAULT_HOUR = 9;

const RANGES = [
  { key: "comercial", label: "07:00 – 18:00", start: 7, end: 18 },
  { key: "estendido", label: "06:00 – 22:00", start: 6, end: 22 },
  { key: "completo", label: "00:00 – 24:00", start: 0, end: 24 },
];

// ---- utilidades de data (timezone do navegador) ----
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayKeyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
// agrupa os eventos por dia UMA vez (O(n)) p/ lookup O(1) por célula do calendário
function bucketByDay(events: Ev[]): Map<string, Ev[]> {
  const m = new Map<string, Ev[]>();
  for (const e of events) {
    const k = dayKeyOf(e.start);
    const arr = m.get(k);
    if (arr) arr.push(e); else m.set(k, [e]);
  }
  return m;
}
const mondayOf = (d: Date) => addDays(startOfDay(d), -(((d.getDay() + 6) % 7)));
const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
const fmtTime = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

type Ev = CalMeeting & { start: Date; end: Date };

export function RoomCalendar({
  meetings,
  rooms,
  onNew,
  onEdit,
  roomFilter,
  onRoomFilterChange,
  view,
  onViewChange,
  cursor,
  onCursorChange,
  customHolidays = [],
}: {
  meetings: CalMeeting[];
  rooms: CalRoom[];
  onNew?: (p: Prefill) => void;
  onEdit?: (m: CalMeeting) => void;
  roomFilter: string;
  onRoomFilterChange: (v: string) => void;
  view: View;
  onViewChange: (v: View) => void;
  cursor: Date;
  onCursorChange: React.Dispatch<React.SetStateAction<Date>>;
  customHolidays?: { day: string; name: string }[];
}) {
  const setView = onViewChange;
  const setCursor = onCursorChange;
  const [rangeKey, setRangeKey] = useState<string>("comercial");
  const [detail, setDetail] = useState<Ev | null>(null);
  const [confirmDel, setConfirmDel] = useState<Ev | null>(null);
  const [delErr, setDelErr] = useState("");
  const [delPending, startDel] = useTransition();
  const router = useRouter();
  const today = new Date();
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[0];

  const events: Ev[] = useMemo(
    () =>
      meetings
        .filter((m) => roomFilter === "all" || m.room?.id === roomFilter)
        .map((m) => ({ ...m, start: new Date(m.starts_at), end: new Date(m.ends_at) })),
    [meetings, roomFilter],
  );

  const goToday = () => setCursor(new Date());
  const move = (dir: number) =>
    setCursor((c) => {
      if (view === "month") return new Date(c.getFullYear(), c.getMonth() + dir, 1);
      if (view === "week") return addDays(c, dir * 7);
      return addDays(c, dir);
    });

  const openDay = (d: Date) => {
    setCursor(d);
    setView("day");
  };

  // clique em vaga vazia -> abre "Nova reunião" pré-preenchida
  const newAt = (day: Date, minutes: number) => {
    if (!onNew) return;
    const start = startOfDay(day);
    start.setMinutes(minutes);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + 60);
    onNew({
      startInput: toLocalInput(start),
      endInput: toLocalInput(end),
      roomId: roomFilter === "all" ? null : roomFilter,
    });
  };

  const label =
    view === "month"
      ? cap(cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }))
      : view === "week"
        ? weekLabel(mondayOf(cursor))
        : cap(cursor.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }));

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(mondayOf(cursor), i));

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {/* toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          padding: "0.85rem 1rem",
          borderBottom: "1px solid var(--border)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button className="btn btn-ghost btn-sm" onClick={goToday}>Hoje</button>
          <button className="btn btn-ghost btn-sm" onClick={() => move(-1)} aria-label="Anterior">‹</button>
          <button className="btn btn-ghost btn-sm" onClick={() => move(1)} aria-label="Próximo">›</button>
          <strong style={{ fontSize: "1rem", marginLeft: "0.3rem" }}>{label}</strong>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <select
            className="select"
            value={roomFilter}
            onChange={(e) => onRoomFilterChange(e.target.value)}
            style={{ width: "auto", padding: "0.35rem 0.6rem", fontSize: "0.82rem" }}
            title="Filtrar por sala"
          >
            <option value="all">Todas as salas</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          {view !== "month" && (
            <select
              className="select"
              value={rangeKey}
              onChange={(e) => setRangeKey(e.target.value)}
              style={{ width: "auto", padding: "0.35rem 0.6rem", fontSize: "0.82rem" }}
              title="Faixa de horário"
            >
              {RANGES.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
          )}
          <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            {([
              ["month", "Mês"],
              ["week", "Semana"],
              ["day", "Dia"],
            ] as [View, string][]).map(([v, lbl]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="btn btn-sm"
                style={{ borderRadius: 0, background: view === v ? "var(--primary)" : "var(--surface)", color: view === v ? "#fff" : "var(--text)" }}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: "0 1rem 1rem" }}>
        {view === "month" && (
          <MonthView cursor={cursor} today={today} events={events} holidays={customHolidays} onPick={setDetail} onDay={openDay} onSlot={(d) => newAt(d, DEFAULT_HOUR * 60)} />
        )}
        {view === "week" && (
          <TimeGrid days={weekDays} startHour={range.start} endHour={range.end} today={today} events={events} holidays={customHolidays} onPick={setDetail} onSlot={newAt} />
        )}
        {view === "day" && (
          <TimeGrid days={[startOfDay(cursor)]} startHour={range.start} endHour={range.end} today={today} events={events} holidays={customHolidays} onPick={setDetail} onSlot={newAt} />
        )}

        {roomFilter === "all" && rooms.length > 0 && (
          <div className="cal-legend">
            {rooms.map((r) => (
              <span key={r.id}><i style={{ background: r.color }} /> {r.name}</span>
            ))}
          </div>
        )}
      </div>

      {detail && (
        <DetailModal
          ev={detail}
          onClose={() => setDetail(null)}
          onEdit={onEdit ? () => { onEdit(detail); setDetail(null); } : undefined}
          onDelete={() => { setConfirmDel(detail); setDetail(null); }}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          open
          title="Excluir reunião"
          message={delErr
            ? <span style={{ color: "#dc2626" }}>{delErr}</span>
            : <>Excluir <strong>{confirmDel.title}</strong>? Os participantes com e-mail recebem um cancelamento.</>}
          confirmLabel="Excluir"
          cancelLabel="Voltar"
          tone="danger"
          pending={delPending}
          onConfirm={() => {
            const ev = confirmDel;
            startDel(async () => {
              const fd = new FormData();
              fd.append("id", ev.id);
              const res = await deleteMeeting(fd);
              if (res?.error) { setDelErr(res.error); return; }
              setConfirmDel(null);
              setDelErr("");
              router.refresh();
            });
          }}
          onClose={() => { setConfirmDel(null); setDelErr(""); }}
        />
      )}
    </div>
  );
}

// ---------------- MÊS (cabeçalho + dias no mesmo grid) ----------------
function MonthView({
  cursor,
  today,
  events,
  holidays,
  onPick,
  onDay,
  onSlot,
}: {
  cursor: Date;
  today: Date;
  events: Ev[];
  holidays: { day: string; name: string }[];
  onPick: (e: Ev) => void;
  onDay: (d: Date) => void;
  onSlot: (d: Date) => void;
}) {
  const gridStart = mondayOf(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const month = cursor.getMonth();
  const byDay = bucketByDay(events);

  return (
    <div className="cal-month">
      {WEEKDAYS.map((w) => <div key={w} className="cal-mhead">{w}</div>)}
      {days.map((day) => {
        const dayEvents = (byDay.get(dayKeyOf(day)) ?? [])
          .slice()
          .sort((a, b) => a.start.getTime() - b.start.getTime());
        const visible = dayEvents.slice(0, 3);
        const extra = dayEvents.length - visible.length;
        const hol = holidayName(day, holidays);
        const sun = !hol && isSunday(day);
        return (
          <div
            key={day.toISOString()}
            className={`cal-day${day.getMonth() !== month ? " cal-out" : ""}${hol ? " cal-holiday" : sun ? " cal-sunday" : ""}`}
            style={{ cursor: "pointer" }}
            onClick={() => onSlot(day)}
            title={hol ? `${hol} (feriado) · clique para agendar` : sun ? "Domingo (dia não útil) · clique para agendar" : "Clique para agendar"}
          >
            <span
              className={`cal-daynum${sameDay(day, today) ? " cal-today" : ""}`}
              onClick={(e) => { e.stopPropagation(); onDay(day); }}
              title="Ver o dia"
            >
              {day.getDate()}
            </span>
            {hol && <span className="cal-holiday-tag" title={hol}>{hol}</span>}
            {sun && <span className="cal-sunday-tag">Domingo</span>}
            {visible.map((e) => {
              const color = e.room?.color ?? DEFAULT_COLOR;
              return (
                <div
                  key={e.id}
                  className={`cal-chip${e.status === "cancelled" ? " cal-cancelled" : ""}`}
                  style={{ ["--c" as string]: color, background: color + "14" }}
                  title={`${e.title} · ${fmtTime(e.start)}–${fmtTime(e.end)}${e.room ? " · " + e.room.name : ""}`}
                  onClick={(ev) => { ev.stopPropagation(); onPick(e); }}
                >
                  <span className="cal-chip-time">{fmtTime(e.start)}</span>
                  <span className="cal-chip-title">{e.title}</span>
                </div>
              );
            })}
            {extra > 0 && (
              <span className="cal-more" onClick={(e) => { e.stopPropagation(); onDay(day); }}>+{extra} mais</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------- GRADE DE HORAS (semana e dia) ----------------
function TimeGrid({
  days,
  startHour,
  endHour,
  today,
  events,
  holidays,
  onPick,
  onSlot,
}: {
  days: Date[];
  startHour: number;
  endHour: number;
  today: Date;
  events: Ev[];
  holidays: { day: string; name: string }[];
  onPick: (e: Ev) => void;
  onSlot: (day: Date, minutes: number) => void;
}) {
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;
  const byDay = bucketByDay(events);

  const handleColClick = (e: React.MouseEvent<HTMLDivElement>, day: Date) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    let minutes = startHour * 60 + (y / HOUR_PX) * 60;
    minutes = Math.max(startHour * 60, Math.min(endHour * 60 - 60, minutes));
    minutes = Math.round(minutes / 30) * 30;
    onSlot(day, minutes);
  };

  return (
    <div className="cal-week-wrap">
      <div className="cal-week-head" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => {
          const hol = holidayName(d, holidays);
          const sun = !hol && isSunday(d);
          return (
            <div key={d.toISOString()}>
              <div className="cal-wd">{WEEKDAYS[(d.getDay() + 6) % 7]}</div>
              <div className={`cal-wn${sameDay(d, today) ? " cal-today" : ""}`}>{d.getDate()}</div>
              {hol && <div className="cal-holiday-tag" title={hol}>{hol}</div>}
              {sun && <div className="cal-sunday-tag">Domingo</div>}
            </div>
          );
        })}
      </div>
      <div className="cal-week-body" style={{ gridTemplateColumns: cols }}>
        <div className="cal-timecol">
          {hours.map((h) => (
            <div key={h} className="cal-timecell">{String(h).padStart(2, "0")}:00</div>
          ))}
        </div>
        {days.map((day) => {
          const dayEvents = byDay.get(dayKeyOf(day)) ?? [];
          const laid = layoutDay(dayEvents);
          const hol = holidayName(day, holidays);
          const sun = !hol && isSunday(day);
          return (
            <div key={day.toISOString()} className={`cal-daycol${hol ? " cal-holiday" : sun ? " cal-sunday" : ""}`} style={{ cursor: "pointer" }} onClick={(e) => handleColClick(e, day)}>
              {hours.map((h) => <div key={h} className="cal-hourline" />)}
              {laid.map(({ e, leftPct, widthPct }) => {
                const s = Math.max(minutesOf(e.start), startHour * 60);
                const en = Math.min(minutesOf(e.end), endHour * 60);
                if (en <= s) return null;
                const top = ((s - startHour * 60) / 60) * HOUR_PX;
                const height = Math.max(20, ((en - s) / 60) * HOUR_PX - 2);
                const color = e.room?.color ?? DEFAULT_COLOR;
                return (
                  <div
                    key={e.id}
                    className="cal-event"
                    style={{
                      top,
                      height,
                      left: `calc(${leftPct}% + 3px)`,
                      width: `calc(${widthPct}% - 5px)`,
                      ["--c" as string]: color,
                      background: color + "1f",
                      opacity: e.status === "cancelled" ? 0.55 : 1,
                    }}
                    title={`${e.title} · ${fmtTime(e.start)}–${fmtTime(e.end)}${e.room ? " · " + e.room.name : ""}`}
                    onClick={(ev) => { ev.stopPropagation(); onPick(e); }}
                  >
                    <div className="cal-ev-title" style={{ textDecoration: e.status === "cancelled" ? "line-through" : "none" }}>{e.title}</div>
                    <div className="cal-ev-time">{fmtTime(e.start)}–{fmtTime(e.end)}{e.room ? ` · ${e.room.name}` : ""}</div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// posiciona eventos sobrepostos lado a lado (clusters)
function layoutDay(evs: Ev[]) {
  const sorted = [...evs].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime(),
  );
  const out: { e: Ev; leftPct: number; widthPct: number }[] = [];
  let cluster: Ev[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    const lanesEnd: number[] = [];
    const lane = new Map<string, number>();
    for (const e of cluster) {
      let placed = false;
      for (let i = 0; i < lanesEnd.length; i++) {
        if (lanesEnd[i] <= e.start.getTime()) {
          lanesEnd[i] = e.end.getTime();
          lane.set(e.id, i);
          placed = true;
          break;
        }
      }
      if (!placed) {
        lane.set(e.id, lanesEnd.length);
        lanesEnd.push(e.end.getTime());
      }
    }
    const n = lanesEnd.length;
    for (const e of cluster) {
      const i = lane.get(e.id)!;
      out.push({ e, leftPct: (i * 100) / n, widthPct: 100 / n });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const e of sorted) {
    if (cluster.length && e.start.getTime() >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.end.getTime());
  }
  flush();
  return out;
}

// ---------------- DETALHE ----------------
function DetailModal({ ev, onClose, onEdit, onDelete }: { ev: Ev; onClose: () => void; onEdit?: () => void; onDelete?: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 1rem", zIndex: 60 }}
    >
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 440, boxShadow: "var(--shadow)" }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{ev.title}</h2>
          <button onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>
        <div style={{ padding: "1.1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.7rem", fontSize: "0.9rem" }}>
          <Row label="Quando">
            {cap(ev.start.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }))}
            <br />
            <span className="muted">{fmtTime(ev.start)} – {fmtTime(ev.end)}</span>
          </Row>
          <Row label="Sala">
            {ev.room ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
                <i style={{ width: 10, height: 10, borderRadius: 3, background: ev.room.color, display: "inline-block" }} />
                {ev.room.name}
              </span>
            ) : <span className="soft">Sem sala</span>}
          </Row>
          <Row label="Status"><Badge tone={MEETING_STATUS_TONE[ev.status]}>{MEETING_STATUS[ev.status]}</Badge></Row>
          <Row label="Agendado por">
            {ev.creatorName ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
                <Avatar name={ev.creatorName} />
                {ev.creatorName}
              </span>
            ) : <span className="soft">—</span>}
          </Row>
          {ev.description && <Row label="Descrição"><span className="muted">{ev.description}</span></Row>}
        </div>
        {(onEdit || onDelete) && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", padding: "0.9rem 1.25rem", borderTop: "1px solid var(--border)" }}>
            {onDelete && (
              <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>Excluir</button>
            )}
            {onEdit && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>Editar</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "92px 1fr", gap: "0.6rem", alignItems: "start" }}>
      <span className="soft" style={{ fontSize: "0.78rem", fontWeight: 600, paddingTop: 1 }}>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function weekLabel(start: Date) {
  const end = addDays(start, 6);
  const f = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  return `${f(start)} – ${f(end)} de ${end.getFullYear()}`;
}
