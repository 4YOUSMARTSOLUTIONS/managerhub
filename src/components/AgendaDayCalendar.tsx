"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { AGENDA_STATUS_LABEL, WEEKDAYS_PT } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { dateFromYMD, fmtMinutes } from "@/lib/agenda-schedule";
import type { DayItem } from "@/lib/agenda-types";
import type { Enums } from "@/types/database";

const BASE_PX_PER_MIN = 52 / 60; // escala padrão
const MIN_BLOCK_PX = 26; // altura mínima legível de um bloco
const MAX_PX_PER_MIN = 4.5; // teto para não esticar demais

function statusColor(s: Enums<"agenda_log_status">): string {
  return s === "feito" ? "var(--mh-success)" : s === "parcial" ? "var(--mh-warning)" : s === "nao_feito" ? "var(--mh-danger)" : "var(--mh-text-3)";
}
function toMin(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

export function AgendaDayCalendar({
  subjectName, dateStr, todayStr, items, nonWorking, onChangeDate, onToday, onOpenItem,
}: {
  subjectName: string;
  dateStr: string;
  todayStr: string;
  items: DayItem[];
  nonWorking: string | null;
  onChangeDate: (delta: number) => void;
  onToday: () => void;
  onOpenItem: (item: DayItem) => void;
}) {
  const d = dateFromYMD(dateStr);
  const untimed = items.filter((it) => toMin(it.time) == null);

  const timed = items
    .map((it) => ({ it, start: toMin(it.time) as number }))
    .filter((x) => x.start != null)
    .sort((a, b) => a.start - b.start);

  // faixa de horas exibida (dinâmica, com margem)
  let minH = 7, maxH = 19;
  for (const { it, start } of timed) {
    minH = Math.min(minH, Math.floor(start / 60));
    maxH = Math.max(maxH, Math.ceil((start + Math.max(30, it.durationMin)) / 60));
  }
  minH = Math.max(0, minH); maxH = Math.min(24, maxH);
  const hours = Array.from({ length: maxH - minH + 1 }, (_, i) => minH + i);

  // escala POR HORA: só a faixa com tarefas apertadas cresce; as demais ficam compactas.
  const pxByHour = new Map<number, number>();
  for (let h = minH; h < maxH; h++) {
    const starts = timed.filter((t) => t.start >= h * 60 && t.start < (h + 1) * 60).map((t) => t.start).sort((a, b) => a - b);
    if (starts.length < 2) { pxByHour.set(h, BASE_PX_PER_MIN); continue; }
    let minGap = Infinity;
    for (let i = 1; i < starts.length; i++) minGap = Math.min(minGap, starts[i] - starts[i - 1]);
    pxByHour.set(h, Math.min(MAX_PX_PER_MIN, Math.max(BASE_PX_PER_MIN, MIN_BLOCK_PX / Math.max(5, minGap))));
  }
  // offsets acumulados (cada hora com sua própria altura) + mapeamento minuto -> pixel
  const yOffset = new Map<number, number>();
  let acc = 0;
  for (let h = minH; h <= maxH; h++) { yOffset.set(h, acc); if (h < maxH) acc += (pxByHour.get(h) ?? BASE_PX_PER_MIN) * 60; }
  const gridHeight = acc;
  const yAt = (m: number) => {
    const hh = Math.min(Math.max(Math.floor(m / 60), minH), maxH - 1);
    return (yOffset.get(hh) ?? 0) + (m - hh * 60) * (pxByHour.get(hh) ?? BASE_PX_PER_MIN);
  };

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--mh-border)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button type="button" className="icon-btn" onClick={() => onChangeDate(-1)} aria-label="Dia anterior"><ChevronLeft size={16} /></button>
          <div style={{ minWidth: 190, textAlign: "center" }}>
            <div style={{ fontWeight: 700 }}>{WEEKDAYS_PT[d.getDay()]}, {formatDate(dateStr)}</div>
            <div className="soft" style={{ fontSize: "0.74rem" }}>{subjectName}</div>
          </div>
          <button type="button" className="icon-btn" onClick={() => onChangeDate(1)} aria-label="Próximo dia"><ChevronRight size={16} /></button>
          {dateStr !== todayStr && <button type="button" className="btn btn-ghost btn-sm" onClick={onToday}>Hoje</button>}
        </div>
      </div>

      {nonWorking && (
        <div style={{ padding: "0.7rem 1.1rem", background: "var(--mh-surface-2)", borderBottom: "1px solid var(--mh-border)", fontSize: "0.83rem", color: "var(--mh-text-2)" }}>
          Dia não trabalhado ({nonWorking}). As tarefas deste dia não são cobradas.
        </div>
      )}

      {/* itens sem horário / tempo médio */}
      {untimed.length > 0 && (
        <div style={{ padding: "0.7rem 1.1rem", borderBottom: "1px solid var(--mh-border)", display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
          <span className="soft" style={{ fontSize: "0.72rem", marginRight: "0.2rem" }}>Sem horário:</span>
          {untimed.map((it) => (
            <button key={it.key} type="button" onClick={() => onOpenItem(it)}
              style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", border: `1px solid var(--mh-border)`, borderLeft: `3px solid ${statusColor(it.status)}`, borderRadius: "var(--mh-radius-sm)", background: "var(--mh-surface-1)", padding: "0.25rem 0.5rem", fontSize: "0.78rem", cursor: "pointer" }}>
              {it.title}{it.durationMin > 0 ? <span className="soft">· {fmtMinutes(it.durationMin)}</span> : null}
            </button>
          ))}
        </div>
      )}

      {/* grade horária */}
      <div style={{ position: "relative", height: gridHeight, margin: "0.5rem 0" }}>
        {hours.map((h) => (
          <div key={h} style={{ position: "absolute", top: yOffset.get(h) ?? 0, left: 0, right: 0, borderTop: "1px solid var(--mh-border)" }}>
            <span style={{ position: "absolute", top: -8, left: 8, fontSize: "0.68rem", color: "var(--mh-text-3)", background: "var(--mh-surface-1)", padding: "0 4px" }}>{String(h).padStart(2, "0")}:00</span>
          </div>
        ))}
        <div style={{ position: "absolute", left: 56, right: 10, top: 0, bottom: 0 }}>
          {timed.map(({ it, start }, idx) => {
            const nextStart = idx + 1 < timed.length ? timed[idx + 1].start : Infinity;
            const top = yAt(start);
            const gapPx = nextStart === Infinity ? Infinity : yAt(nextStart) - top;
            const durPx = yAt(start + Math.max(it.durationMin, 1)) - top;
            // altura legível, mas nunca ultrapassando o início da próxima tarefa
            const height = Math.max(6, Math.min(Math.max(durPx, MIN_BLOCK_PX), gapPx));
            const col = statusColor(it.status);
            return (
              <button key={it.key} type="button" onClick={() => onOpenItem(it)}
                style={{
                  position: "absolute", top, left: 0, right: 0, height, textAlign: "left", cursor: "pointer",
                  background: `color-mix(in srgb, ${col} 16%, var(--mh-surface-1))`,
                  borderLeft: `3px solid ${col}`, border: `1px solid color-mix(in srgb, ${col} 34%, transparent)`,
                  borderRadius: "var(--mh-radius-sm)", padding: height < 24 ? "0 0.5rem" : "0.2rem 0.5rem", overflow: "hidden",
                  display: "flex", flexDirection: "column", justifyContent: "center",
                }}>
                <div style={{ fontSize: "0.76rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.25 }}>
                  {it.time?.slice(0, 5)} {it.title}
                  {it.kind === "checklist" && <Badge tone="purple">Checklist</Badge>}
                </div>
                {height > 40 && (
                  <div className="soft" style={{ fontSize: "0.7rem" }}>{it.agendaName}{it.durationMin > 0 ? ` · ${fmtMinutes(it.durationMin)}` : ""} · {AGENDA_STATUS_LABEL[it.status]}</div>
                )}
              </button>
            );
          })}
        </div>
        {timed.length === 0 && untimed.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--mh-text-3)", fontSize: "0.85rem" }}>Nada agendado para este dia.</div>
        )}
      </div>
    </div>
  );
}
