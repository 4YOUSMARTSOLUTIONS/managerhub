"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { WEEKDAYS_PT } from "@/lib/constants";
import { dateFromYMD, ymd } from "@/lib/agenda-schedule";
import type { DayItem } from "@/lib/agenda-types";
import type { Enums } from "@/types/database";

const BASE_PX_PER_MIN = 46 / 60;
const MIN_BLOCK_PX = 20;
const MAX_PX_PER_MIN = 4;

function stColor(s: Enums<"agenda_log_status">): string {
  return s === "feito" ? "var(--mh-success)" : s === "parcial" ? "var(--mh-warning)" : s === "nao_feito" ? "var(--mh-danger)" : "var(--mh-text-3)";
}
function toMin(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

export function AgendaWeekView({
  dateStr, todayStr, getDayItems, onSetDate, onToday, onOpenItem,
}: {
  dateStr: string;
  todayStr: string;
  getDayItems: (ds: string) => { items: DayItem[]; nonWorking: string | null };
  onSetDate: (ds: string) => void;
  onToday: () => void;
  onOpenItem: (item: DayItem) => void;
}) {
  const anchor = dateFromYMD(dateStr);
  const start = new Date(anchor); start.setDate(anchor.getDate() - anchor.getDay());
  const shift = (delta: number) => { const d = new Date(start); d.setDate(start.getDate() + delta); onSetDate(ymd(d)); };

  const perDay = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const ds = ymd(d);
    const { items, nonWorking } = getDayItems(ds);
    const timed = items
      .map((it) => ({ it, start: toMin(it.time) as number }))
      .filter((x) => x.start != null)
      .sort((a, b) => a.start - b.start);
    const untimed = items.filter((it) => toMin(it.time) == null);
    return { d, ds, timed, untimed, nonWorking, isToday: ds === todayStr };
  });
  const anyUntimed = perDay.some((p) => p.untimed.length > 0);

  // faixa de horas compartilhada
  let minH = 7, maxH = 19;
  for (const p of perDay) for (const { it, start: s } of p.timed) {
    minH = Math.min(minH, Math.floor(s / 60));
    maxH = Math.max(maxH, Math.ceil((s + Math.max(30, it.durationMin)) / 60));
  }
  minH = Math.max(0, minH); maxH = Math.min(24, maxH);
  const hours = Array.from({ length: maxH - minH + 1 }, (_, i) => minH + i);

  // escala por hora (densidade máxima dentro de um único dia naquela hora)
  const pxByHour = new Map<number, number>();
  for (let h = minH; h < maxH; h++) {
    let minGap = Infinity;
    for (const p of perDay) {
      const starts = p.timed.filter((t) => t.start >= h * 60 && t.start < (h + 1) * 60).map((t) => t.start).sort((a, b) => a - b);
      for (let i = 1; i < starts.length; i++) minGap = Math.min(minGap, starts[i] - starts[i - 1]);
    }
    pxByHour.set(h, Number.isFinite(minGap) ? Math.min(MAX_PX_PER_MIN, Math.max(BASE_PX_PER_MIN, MIN_BLOCK_PX / Math.max(5, minGap))) : BASE_PX_PER_MIN);
  }
  const yOffset = new Map<number, number>();
  let acc = 0;
  for (let h = minH; h <= maxH; h++) { yOffset.set(h, acc); if (h < maxH) acc += (pxByHour.get(h) ?? BASE_PX_PER_MIN) * 60; }
  const gridHeight = acc;
  const yAt = (m: number) => {
    const hh = Math.min(Math.max(Math.floor(m / 60), minH), maxH - 1);
    return (yOffset.get(hh) ?? 0) + (m - hh * 60) * (pxByHour.get(hh) ?? BASE_PX_PER_MIN);
  };

  const gridCols = "48px repeat(7, minmax(120px, 1fr))";

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--mh-border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button type="button" className="icon-btn" onClick={() => shift(-7)} aria-label="Semana anterior"><ChevronLeft size={16} /></button>
          <div style={{ minWidth: 190, textAlign: "center", fontWeight: 700 }}>{perDay[0].d.getDate()}/{perDay[0].d.getMonth() + 1} a {perDay[6].d.getDate()}/{perDay[6].d.getMonth() + 1}</div>
          <button type="button" className="icon-btn" onClick={() => shift(7)} aria-label="Próxima semana"><ChevronRight size={16} /></button>
          {!perDay.some((p) => p.isToday) && <button type="button" className="btn btn-ghost btn-sm" onClick={onToday}>Hoje</button>}
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 760 }}>
          {/* cabeçalho dos dias */}
          <div style={{ display: "grid", gridTemplateColumns: gridCols, borderBottom: "1px solid var(--mh-border)" }}>
            <div />
            {perDay.map((p) => (
              <div key={p.ds} style={{ textAlign: "center", padding: "0.4rem 0", borderLeft: "1px solid var(--mh-border)", background: p.nonWorking ? "var(--mh-surface-2)" : undefined }}>
                <div className="soft" style={{ fontSize: "0.68rem" }}>{WEEKDAYS_PT[p.d.getDay()].slice(0, 3)}</div>
                <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 22, height: 22, borderRadius: 999, fontWeight: 700, fontSize: "0.8rem", background: p.isToday ? "var(--mh-primary-500)" : "transparent", color: p.isToday ? "#fff" : "var(--mh-text-1)" }}>{p.d.getDate()}</div>
              </div>
            ))}
          </div>

          {/* faixa sem horário */}
          {anyUntimed && (
            <div style={{ display: "grid", gridTemplateColumns: gridCols, borderBottom: "1px solid var(--mh-border)" }}>
              <div className="soft" style={{ fontSize: "0.62rem", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>sem<br />hora</div>
              {perDay.map((p) => (
                <div key={p.ds} style={{ borderLeft: "1px solid var(--mh-border)", padding: "0.25rem", display: "flex", flexDirection: "column", gap: "0.2rem", minWidth: 0 }}>
                  {p.untimed.map((it) => (
                    <button key={it.key} type="button" title={it.title} onClick={() => onOpenItem(it)}
                      style={{ textAlign: "left", width: "100%", maxWidth: "100%", minWidth: 0, cursor: "pointer", fontSize: "0.66rem", borderLeft: `3px solid ${stColor(it.status)}`, background: `color-mix(in srgb, ${stColor(it.status)} 14%, var(--mh-surface-1))`, border: "none", borderRadius: "3px", padding: "0.08rem 0.28rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {it.title}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* grade horária */}
          <div style={{ display: "grid", gridTemplateColumns: gridCols }}>
            <div style={{ position: "relative", height: gridHeight }}>
              {hours.map((h) => (
                <span key={h} style={{ position: "absolute", top: (yOffset.get(h) ?? 0) - 6, right: 6, fontSize: "0.66rem", color: "var(--mh-text-3)" }}>{String(h).padStart(2, "0")}:00</span>
              ))}
            </div>
            {perDay.map((p) => (
              <div key={p.ds} style={{ position: "relative", height: gridHeight, borderLeft: "1px solid var(--mh-border)", background: p.nonWorking ? "var(--mh-surface-2)" : undefined, minWidth: 0 }}>
                {hours.map((h) => (
                  <div key={h} style={{ position: "absolute", top: yOffset.get(h) ?? 0, left: 0, right: 0, borderTop: "1px solid var(--mh-border)" }} />
                ))}
                {p.timed.map(({ it, start: s }, idx) => {
                  const nextStart = idx + 1 < p.timed.length ? p.timed[idx + 1].start : Infinity;
                  const top = yAt(s);
                  const gapPx = nextStart === Infinity ? Infinity : yAt(nextStart) - top;
                  const durPx = yAt(s + Math.max(it.durationMin, 1)) - top;
                  const height = Math.max(5, Math.min(Math.max(durPx, MIN_BLOCK_PX), gapPx));
                  const col = stColor(it.status);
                  return (
                    <button key={it.key} type="button" title={`${it.time?.slice(0, 5)} ${it.title}`} onClick={() => onOpenItem(it)}
                      style={{ position: "absolute", top, left: 1, right: 1, height, textAlign: "left", cursor: "pointer", overflow: "hidden", minWidth: 0, background: `color-mix(in srgb, ${col} 16%, var(--mh-surface-1))`, border: `1px solid color-mix(in srgb, ${col} 34%, transparent)`, borderLeft: `3px solid ${col}`, borderRadius: "3px", padding: "0 0.25rem", fontSize: "0.66rem", lineHeight: 1.2, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {it.time?.slice(0, 5)} {it.title}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
