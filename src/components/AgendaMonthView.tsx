"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { WEEKDAYS_PT } from "@/lib/constants";
import { dateFromYMD, ymd } from "@/lib/agenda-schedule";
import type { DayItem } from "@/lib/agenda-types";
import type { Enums } from "@/types/database";

function stColor(s: Enums<"agenda_log_status">): string {
  return s === "feito" ? "var(--mh-success)" : s === "parcial" ? "var(--mh-warning)" : s === "nao_feito" ? "var(--mh-danger)" : "var(--mh-text-3)";
}
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function AgendaMonthView({
  dateStr, todayStr, getDayItems, onSetDate, onToday, onOpenItem, onPickDay,
}: {
  dateStr: string;
  todayStr: string;
  getDayItems: (ds: string) => { items: DayItem[]; nonWorking: string | null };
  onSetDate: (ds: string) => void;
  onToday: () => void;
  onOpenItem: (item: DayItem) => void;
  onPickDay: (ds: string) => void;
}) {
  const anchor = dateFromYMD(dateStr);
  const y = anchor.getFullYear(), m = anchor.getMonth();
  const first = new Date(y, m, 1);
  const gridStart = new Date(first); gridStart.setDate(1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const shiftMonth = (delta: number) => onSetDate(ymd(new Date(y, m + delta, 1)));
  const today = dateFromYMD(todayStr);
  const todayInView = today.getFullYear() === y && today.getMonth() === m;

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--mh-border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button type="button" className="icon-btn" onClick={() => shiftMonth(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
          <div style={{ minWidth: 170, textAlign: "center", fontWeight: 700 }}>{MONTHS[m]} {y}</div>
          <button type="button" className="icon-btn" onClick={() => shiftMonth(1)} aria-label="Próximo mês"><ChevronRight size={16} /></button>
          {!todayInView && <button type="button" className="btn btn-ghost btn-sm" onClick={onToday}>Hoje</button>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--mh-border)" }}>
        {WEEKDAYS_PT.map((w) => (
          <div key={w} className="soft" style={{ textAlign: "center", padding: "0.4rem 0", fontSize: "0.7rem", fontWeight: 600 }}>{w.slice(0, 3)}</div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {cells.map((d) => {
          const ds = ymd(d);
          const inMonth = d.getMonth() === m;
          const isToday = ds === todayStr;
          const { items, nonWorking } = getDayItems(ds);
          const shown = items.slice(0, 3);
          const extra = items.length - shown.length;
          return (
            <div key={ds} onClick={() => onPickDay(ds)}
              style={{ minWidth: 0, minHeight: 92, borderRight: "1px solid var(--mh-border)", borderBottom: "1px solid var(--mh-border)", padding: "0.25rem", cursor: "pointer", background: nonWorking ? "var(--mh-surface-2)" : undefined, opacity: inMonth ? 1 : 0.4, overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 20, height: 20, borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: isToday ? "var(--mh-primary-500)" : "transparent", color: isToday ? "#fff" : "var(--mh-text-1)" }}>{d.getDate()}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.12rem", marginTop: "0.1rem", minWidth: 0 }}>
                {shown.map((it) => (
                  <button key={it.key} type="button" title={`${it.time ? it.time.slice(0, 5) + " " : ""}${it.title}`} onClick={(e) => { e.stopPropagation(); onOpenItem(it); }}
                    style={{ display: "block", textAlign: "left", width: "100%", maxWidth: "100%", minWidth: 0, cursor: "pointer", fontSize: "0.66rem", lineHeight: 1.25, borderLeft: `3px solid ${stColor(it.status)}`, background: `color-mix(in srgb, ${stColor(it.status)} 14%, var(--mh-surface-1))`, borderRadius: "3px", padding: "0.08rem 0.28rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: "none" }}>
                    {it.time ? `${it.time.slice(0, 5)} ` : ""}{it.title}
                  </button>
                ))}
                {extra > 0 && <span className="soft" style={{ fontSize: "0.64rem" }}>+{extra}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
