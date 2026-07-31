"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { AGENDA_FREQUENCY_LABEL, AGENDA_WORKDAY_MINUTES, WEEKDAYS_PT } from "@/lib/constants";
import { shortName } from "@/lib/format";
import { taskOccursOn, nonWorkingReason, dateFromYMD, ymd, fmtMinutes } from "@/lib/agenda-schedule";
import type { AgendaFull } from "@/lib/agenda-types";

type Opt = { id: string; name: string };
const BUDGET = AGENDA_WORKDAY_MINUTES;

export function TimeMotionManager(props: {
  currentUserId: string;
  isAdmin: boolean;
  today: string;
  people: Opt[];
  nameById: Record<string, string>;
  reportIds: string[];
  agendas: AgendaFull[];
  holidays: { day: string; name: string }[];
}) {
  const { currentUserId, isAdmin, people, nameById, reportIds, agendas, holidays } = props;

  const [period, setPeriod] = useState<"prox4" | "mes" | "semana" | "custom">("prox4");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string>(currentUserId);

  const range: [Date, Date] = useMemo(() => {
    const t = dateFromYMD(props.today);
    switch (period) {
      case "mes": return [new Date(t.getFullYear(), t.getMonth(), 1, 12), new Date(t.getFullYear(), t.getMonth() + 1, 0, 12)];
      case "semana": { const s = new Date(t); s.setDate(t.getDate() - t.getDay()); const e = new Date(s); e.setDate(s.getDate() + 6); return [s, e]; }
      case "custom": return [from ? dateFromYMD(from) : t, to ? dateFromYMD(to) : new Date(t.getFullYear(), t.getMonth(), t.getDate() + 27, 12)];
      default: { const e = new Date(t); e.setDate(t.getDate() + 27); return [t, e]; } // próximas 4 semanas
    }
  }, [period, from, to, props.today]);

  const load = useMemo(() => {
    const [rf, rt] = range;
    return (subjectId: string) => {
      let totalMin = 0, workingDays = 0, peak = 0, overDays = 0;
      const byWeekdaySum = [0, 0, 0, 0, 0, 0, 0];
      const byWeekdayCount = [0, 0, 0, 0, 0, 0, 0];
      const cur = new Date(rf);
      while (cur <= rt) {
        if (!nonWorkingReason(cur, holidays)) {
          const ds = ymd(cur);
          let dayMin = 0;
          for (const a of agendas) {
            if (!a.active || a.responsibleId !== subjectId) continue;
            if (ds < a.createdDate) continue;
            for (const t of a.tasks) {
              if (!t.active) continue;
              if (!taskOccursOn({ frequency: t.frequency, weekdays: t.weekdays, dayOfMonth: t.dayOfMonth, fixedDate: t.fixedDate }, cur)) continue;
              dayMin += t.durationMinutes;
            }
          }
          totalMin += dayMin; workingDays++;
          peak = Math.max(peak, dayMin);
          if (dayMin > BUDGET) overDays++;
          byWeekdaySum[cur.getDay()] += dayMin;
          byWeekdayCount[cur.getDay()]++;
        }
        cur.setDate(cur.getDate() + 1);
      }
      const avg = workingDays ? totalMin / workingDays : 0;
      const byWeekday = byWeekdaySum.map((s, i) => (byWeekdayCount[i] ? s / byWeekdayCount[i] : 0));
      const taskCount = agendas.filter((a) => a.active && a.responsibleId === subjectId).reduce((n, a) => n + a.tasks.filter((t) => t.active).length, 0);
      return { totalMin, workingDays, avg, peak, overDays, byWeekday, taskCount };
    };
  }, [range, agendas, holidays]);

  const breakdown = useMemo(() => {
    const [rf, rt] = range;
    return (subjectId: string) => {
      const map = new Map<string, { title: string; agendaName: string; freq: string; min: number; occ: number; flexible: boolean }>();
      let workingDays = 0;
      const cur = new Date(rf);
      while (cur <= rt) {
        if (!nonWorkingReason(cur, holidays)) {
          workingDays++;
          const ds = ymd(cur);
          for (const a of agendas) {
            if (!a.active || a.responsibleId !== subjectId) continue;
            if (ds < a.createdDate) continue;
            for (const t of a.tasks) {
              if (!t.active) continue;
              if (!taskOccursOn({ frequency: t.frequency, weekdays: t.weekdays, dayOfMonth: t.dayOfMonth, fixedDate: t.fixedDate }, cur)) continue;
              const e = map.get(t.id) ?? { title: t.title, agendaName: a.name, freq: AGENDA_FREQUENCY_LABEL[t.frequency], min: 0, occ: 0, flexible: t.flexible };
              e.min += t.durationMinutes; e.occ++;
              map.set(t.id, e);
            }
          }
        }
        cur.setDate(cur.getDate() + 1);
      }
      return [...map.values()]
        .map((e) => ({ ...e, avgPerDay: workingDays ? e.min / workingDays : 0 }))
        .sort((a, b) => b.min - a.min);
    };
  }, [range, agendas, holidays]);

  const teamIds = isAdmin && showAll ? people.map((p) => p.id) : [currentUserId, ...reportIds.filter((id) => id !== currentUserId)];
  const teamRows = teamIds.map((id) => ({ id, name: nameById[id] ?? "Usuário", l: load(id) })).sort((a, b) => b.l.avg - a.l.avg);

  const sel = load(selected);
  const selBreak = breakdown(selected);
  const selPct = Math.round((sel.avg / BUDGET) * 100);
  const isManagerView = isAdmin || reportIds.length > 0;
  const maxWeekday = Math.max(1, ...sel.byWeekday);

  const loadTone = (avg: number) => avg > BUDGET ? "red" : avg >= BUDGET * 0.75 ? "amber" : avg >= BUDGET * 0.35 ? "green" : "blue";

  return (
    <div>
      <PageHeader
        title="Tempos e movimentos"
        subtitle="Carga de trabalho planejada a partir das agendas, para equilibrar demandas entre a equipe."
      />

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
        <select className="select" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} style={{ width: "auto" }}>
          <option value="prox4">Próximas 4 semanas</option>
          <option value="mes">Mês atual</option>
          <option value="semana">Semana atual</option>
          <option value="custom">Período personalizado</option>
        </select>
        {period === "custom" && (
          <>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
          </>
        )}
        {isAdmin && (
          <label className="soft" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem" }}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Ver todos
          </label>
        )}
      </div>

      {/* Tabela da equipe (gestor/admin) */}
      {isManagerView && (
        <div style={{ marginBottom: "1rem" }}>
          <Section title="Carga por colaborador" padded={false}>
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead><tr><th>Colaborador</th><th>Tarefas</th><th>Carga média/dia</th><th>% da jornada</th><th>Pico no dia</th><th>Dias &gt; 8h</th><th style={{ textAlign: "right" }}></th></tr></thead>
                <tbody>
                  {teamRows.map((r) => {
                    const p = Math.round((r.l.avg / BUDGET) * 100);
                    return (
                      <tr key={r.id} style={{ background: r.id === selected ? "var(--mh-surface-2)" : undefined }}>
                        <td style={{ fontWeight: 600 }}>{shortName(r.name)}</td>
                        <td className="muted">{r.l.taskCount}</td>
                        <td className="muted">{fmtMinutes(Math.round(r.l.avg))}</td>
                        <td style={{ minWidth: 140 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <div style={{ flex: 1, height: 7, borderRadius: 999, background: "var(--mh-surface-2)", overflow: "hidden", minWidth: 60 }}>
                              <div style={{ width: `${Math.min(100, p)}%`, height: "100%", background: `var(--mh-${loadTone(r.l.avg) === "red" ? "danger" : loadTone(r.l.avg) === "amber" ? "warning" : loadTone(r.l.avg) === "blue" ? "info" : "success"})` }} />
                            </div>
                            <span className="tabular" style={{ fontSize: "0.78rem", fontWeight: 600 }}>{p}%</span>
                          </div>
                        </td>
                        <td className="muted">{fmtMinutes(r.l.peak)}</td>
                        <td>{r.l.overDays > 0 ? <Badge tone="red">{r.l.overDays}</Badge> : <span className="soft">0</span>}</td>
                        <td style={{ textAlign: "right" }}><button className="btn btn-ghost btn-sm" onClick={() => setSelected(r.id)}>Detalhe</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}

      {/* Detalhe do colaborador selecionado */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.85rem", marginBottom: "1rem" }}>
        <StatCard label="Carga média/dia" value={fmtMinutes(Math.round(sel.avg))} hint={`${shortName(nameById[selected] ?? "")}`} tone={loadTone(sel.avg)} />
        <StatCard label="% da jornada (8h)" value={`${selPct}%`} hint={selPct > 100 ? "Acima da jornada" : selPct < 40 ? "Folga na agenda" : "Dentro da jornada"} tone={loadTone(sel.avg)} />
        <StatCard label="Pico em um dia" value={fmtMinutes(sel.peak)} tone={sel.peak > BUDGET ? "red" : "blue"} />
        <StatCard label="Tarefas ativas" value={sel.taskCount} tone="purple" />
        <StatCard label="Dias acima de 8h" value={sel.overDays} tone={sel.overDays > 0 ? "red" : "gray"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(280px, 1.4fr)", gap: "1rem", alignItems: "start" }}>
        <Section title="Carga por dia da semana">
          <div style={{ display: "flex", alignItems: "flex-end", gap: "0.5rem", height: 150 }}>
            {sel.byWeekday.map((m, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.3rem" }}>
                <div className="soft" style={{ fontSize: "0.66rem" }}>{Math.round(m)}</div>
                <div style={{ width: "100%", height: `${(m / maxWeekday) * 110}px`, minHeight: 2, background: m > BUDGET ? "var(--mh-danger)" : "var(--mh-primary-500)", borderRadius: "4px 4px 0 0" }} />
                <div className="soft" style={{ fontSize: "0.68rem" }}>{WEEKDAYS_PT[i].slice(0, 3)}</div>
              </div>
            ))}
          </div>
          <p className="soft" style={{ fontSize: "0.74rem", marginTop: "0.6rem" }}>Média de minutos reservados por dia da semana no período.</p>
        </Section>

        <Section title="Tempo por tarefa" padded={false}>
          {selBreak.length === 0 ? (
            <EmptyState title="Sem tarefas no período" description="Este colaborador não tem tarefas planejadas para o período selecionado." />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead><tr><th>Tarefa</th><th>Frequência</th><th>Ocorrências</th><th>Média/dia</th><th>Total</th></tr></thead>
                <tbody>
                  {selBreak.map((e, i) => (
                    <tr key={i}>
                      <td>{e.title}{e.flexible && <Badge tone="blue">Tempo médio</Badge>}<div className="soft" style={{ fontSize: "0.72rem" }}>{e.agendaName}</div></td>
                      <td className="muted">{e.freq}</td>
                      <td className="muted">{e.occ}</td>
                      <td className="muted">{fmtMinutes(Math.round(e.avgPerDay))}</td>
                      <td className="muted">{fmtMinutes(e.min)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
