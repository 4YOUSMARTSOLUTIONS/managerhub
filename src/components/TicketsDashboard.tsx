"use client";

import { useMemo, useState } from "react";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/Badge";
import { TICKET_STATUS, TICKET_STATUS_TONE } from "@/lib/constants";
import { formatDuration } from "@/lib/format";
import { computeNps } from "@/lib/nps";
import type { Enums } from "@/types/database";
import type { TicketRow, Opt } from "./TicketsManager";

function nowMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const OPENISH: Enums<"ticket_status">[] = ["open", "in_progress", "waiting"];

export function TicketsDashboard({ tickets, sectors }: { tickets: TicketRow[]; sectors: Opt[] }) {
  const [month, setMonth] = useState(nowMonth());
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [sectorId, setSectorId] = useState("");

  const matchFilters = (t: TicketRow) => !sectorId || t.sectorId === sectorId;

  const data = useMemo(() => {
    const inPeriod = (t: TicketRow) =>
      period === "year" ? t.createdAt.slice(0, 4) === month.slice(0, 4) : t.createdAt.slice(0, 7) === month;
    const cohort = tickets.filter((t) => inPeriod(t) && matchFilters(t));
    const resolved = cohort.filter((t) => (t.status === "resolved" || t.status === "closed") && t.resolvedAt);
    const openCohort = cohort.filter((t) => OPENISH.includes(t.status)).length;

    let within = 0, outside = 0, durSum = 0, durN = 0;
    for (const t of resolved) {
      if (t.dueDate) {
        if (new Date(t.resolvedAt!) <= new Date(t.dueDate)) within += 1;
        else outside += 1;
      }
      durSum += (new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime()) / 1000;
      durN += 1;
    }
    const slaBase = within + outside;
    const pctWithin = slaBase ? Math.round((within / slaBase) * 100) : null;
    const pctOutside = slaBase ? 100 - (pctWithin ?? 0) : null;
    const avgDur = durN ? Math.round(durSum / durN) : null;

    const nps = computeNps(cohort.filter((t) => t.npsScore != null).map((t) => t.npsScore as number));

    // agrupa por uma dimensão (setor/categoria) por NOME — evita duplicar (ex.: TI
    // configurável + TI legado). Retorna volume + %SLA.
    const groupBy = (nameOf: (t: TicketRow) => string) => {
      const m = new Map<string, { name: string; total: number; within: number; base: number }>();
      for (const t of cohort) {
        const name = nameOf(t);
        const cur = m.get(name) ?? { name, total: 0, within: 0, base: 0 };
        cur.total += 1;
        if ((t.status === "resolved" || t.status === "closed") && t.resolvedAt && t.dueDate) {
          cur.base += 1;
          if (new Date(t.resolvedAt) <= new Date(t.dueDate)) cur.within += 1;
        }
        m.set(name, cur);
      }
      return [...m.values()].sort((a, b) => b.total - a.total);
    };
    const bySector = groupBy((t) => t.sectorName ?? "Sem setor");
    const byCategory = groupBy((t) => t.categoryName ?? "Sem categoria");

    // por status
    const byStatus = (Object.keys(TICKET_STATUS) as Enums<"ticket_status">[])
      .map((s) => ({ status: s, n: cohort.filter((t) => t.status === s).length }))
      .filter((x) => x.n > 0);

    // backlog / sem responsável (estado atual, fora do filtro de mês)
    const backlog = tickets.filter((t) => OPENISH.includes(t.status) && matchFilters(t)).length;
    const semResp = tickets.filter((t) => OPENISH.includes(t.status) && !t.assigneeId && matchFilters(t)).length;

    return {
      total: cohort.length, resolved: resolved.length, openCohort,
      within, outside, pctWithin, pctOutside, avgDur, nps, bySector, byCategory, byStatus,
      taxaResolucao: cohort.length ? Math.round((resolved.length / cohort.length) * 100) : null,
      backlog, semResp,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, month, period, sectorId]);

  const npsTone = data.nps.total === 0 ? "gray" : data.nps.nps >= 50 ? "green" : data.nps.nps >= 0 ? "amber" : "red";

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", alignItems: "flex-end", marginBottom: "1.1rem" }}>
        <div>
          <label className="label">Período</label>
          <select className="select" value={period} onChange={(e) => setPeriod(e.target.value as "month" | "year")}>
            <option value="month">Mês</option>
            <option value="year">Ano inteiro</option>
          </select>
        </div>
        <div>
          <label className="label">{period === "year" ? "Competência (usa o ano)" : "Competência"}</label>
          <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value || nowMonth())} />
        </div>
        <div>
          <label className="label">Setor</label>
          <select className="select" value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
            <option value="">Todos</option>
            {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "1rem", marginBottom: "1.2rem" }}>
        <StatCard label="Chamados no período" value={String(data.total)} hint={`${data.resolved} resolvidos · ${data.openCohort} em aberto`} tone="blue" />
        <StatCard label="Dentro do SLA" value={data.pctWithin == null ? "—" : `${data.pctWithin}%`} hint={`${data.within} no prazo`} tone="green" />
        <StatCard label="Fora do SLA" value={data.pctOutside == null ? "—" : `${data.pctOutside}%`} hint={`${data.outside} fora do prazo`} tone="red" />
        <StatCard label="NPS" value={data.nps.total === 0 ? "—" : String(data.nps.nps)} hint={`média ${data.nps.media}/10 · ${data.nps.total} aval.`} tone={npsTone} />
        <StatCard label="Tempo médio" value={data.avgDur == null ? "—" : formatDuration(data.avgDur)} hint="resolução (abertura→conclusão)" tone="purple" />
        <StatCard label="Taxa de resolução" value={data.taxaResolucao == null ? "—" : `${data.taxaResolucao}%`} hint={`${data.resolved}/${data.total} da coorte`} tone="amber" />
        <StatCard label="Backlog (abertos)" value={String(data.backlog)} hint="estado atual" tone="blue" />
        <StatCard label="Sem responsável" value={String(data.semResp)} hint="abertos sem dono" tone={data.semResp > 0 ? "red" : "gray"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
        <div className="card card-pad">
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.7rem" }}>Por setor</h3>
          {data.bySector.length === 0 ? <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Sem dados no período.</p> : data.bySector.map((s) => {
            const pct = s.base ? Math.round((s.within / s.base) * 100) : null;
            return (
              <div key={s.name} style={{ marginBottom: "0.6rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: "0.25rem" }}>
                  <span>{s.name} <span className="soft">· {s.total}</span></span>
                  <span style={{ fontWeight: 600 }}>{pct == null ? "—" : `${pct}% SLA`}</span>
                </div>
                <div className="progress-track"><div className="progress-fill" style={{ width: `${pct ?? 0}%`, background: pct == null ? "var(--border)" : pct >= 100 ? "#16a34a" : pct >= 80 ? "#b45309" : "#dc2626" }} /></div>
              </div>
            );
          })}
        </div>

        <div className="card card-pad">
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.7rem" }}>Por categoria</h3>
          {data.byCategory.length === 0 ? <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Sem dados no período.</p> : data.byCategory.map((s) => {
            const pct = s.base ? Math.round((s.within / s.base) * 100) : null;
            return (
              <div key={s.name} style={{ marginBottom: "0.6rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: "0.25rem" }}>
                  <span>{s.name} <span className="soft">· {s.total}</span></span>
                  <span style={{ fontWeight: 600 }}>{pct == null ? "—" : `${pct}% SLA`}</span>
                </div>
                <div className="progress-track"><div className="progress-fill" style={{ width: `${pct ?? 0}%`, background: pct == null ? "var(--border)" : pct >= 100 ? "#16a34a" : pct >= 80 ? "#b45309" : "#dc2626" }} /></div>
              </div>
            );
          })}
        </div>

        <div className="card card-pad">
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.7rem" }}>Por status</h3>
          {data.byStatus.length === 0 ? <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Sem dados no período.</p> : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
              {data.byStatus.map((s) => (
                <div key={s.status} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Badge tone={TICKET_STATUS_TONE[s.status]}>{TICKET_STATUS[s.status]}</Badge>
                  <span style={{ fontWeight: 600 }}>{s.n}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card card-pad">
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.7rem" }}>Satisfação (NPS)</h3>
          {data.nps.total === 0 ? <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Nenhuma avaliação no período.</p> : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", fontSize: "0.85rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>🙂 Promotores (9–10)</span><strong>{data.nps.promotores}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>😐 Neutros (7–8)</span><strong>{data.nps.neutros}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>🙁 Detratores (0–6)</span><strong>{data.nps.detratores}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: "0.45rem" }}>
                <span>NPS</span><strong>{data.nps.nps}</strong>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
