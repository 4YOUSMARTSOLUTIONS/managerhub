"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchSelect } from "@/components/SearchSelect";
import { ImportSustainabilityDialog } from "@/components/ImportSustainabilityDialog";
import { ExportButton } from "@/components/ui/ExportButton";
import {
  createSustKpi, updateSustKpi, deleteSustKpi, upsertSustEntry, deleteSustEntry,
} from "@/lib/actions/sustainability";
import { GOAL_DIRECTION, CONSOLIDATION_LABEL, FAROL_LABEL, FAROL_TONE } from "@/lib/constants";
import { farolAttainment, type FarolStatus } from "@/lib/goals-farol";
import { formatNumber, shortName } from "@/lib/format";
import type { Enums } from "@/types/database";
import { confirmDialog } from "@/components/ui/confirm";

export type SustEntryLite = { period: string; actual: number | null; numerator: number | null; denominator: number | null };
export type SustKpiRow = {
  id: string; sort: number; name: string; ownerId: string | null; ownerName: string | null;
  unit: string; direction: Enums<"goal_direction">; consolidation: Enums<"area_consolidation">;
  target: number | null; entries: SustEntryLite[];
};
export type Member = { id: string; name: string };

const BAR_COLOR: Record<FarolStatus, string> = { atingida: "var(--mh-success)", parcial: "var(--mh-warning)", nao_atingida: "var(--mh-danger)", pendente: "transparent" };
const VAL_COLOR: Record<FarolStatus, string> = { atingida: "var(--mh-success)", parcial: "var(--mh-warning)", nao_atingida: "var(--mh-danger)", pendente: "var(--text-muted)" };

function nowMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
const nowYear = () => String(new Date().getFullYear());
const periodOf = (month: string) => `${month}-01`;
const monthLabel = (month: string) => { const [y, m] = month.split("-"); return `${m}/${y}`; };

function accumulateYear(kpi: SustKpiRow, entries: SustEntryLite[]): { actual: number | null; target: number | null } {
  const acts = entries.map((e) => e.actual).filter((v): v is number => v != null);
  const months = acts.length;
  if (kpi.consolidation === "razao") {
    const nums = entries.map((e) => e.numerator).filter((v): v is number => v != null);
    const dens = entries.map((e) => e.denominator).filter((v): v is number => v != null);
    const den = dens.reduce((s, v) => s + v, 0);
    const actual = dens.length && den !== 0 ? (nums.reduce((s, v) => s + v, 0) / den) * (kpi.unit.trim() === "%" ? 100 : 1) : null;
    return { actual, target: kpi.target };
  }
  if (kpi.consolidation === "media") {
    return { actual: months ? acts.reduce((s, v) => s + v, 0) / months : null, target: kpi.target };
  }
  return { actual: months ? acts.reduce((s, v) => s + v, 0) : null, target: kpi.target != null && months ? kpi.target * months : kpi.target };
}

function fmtVal(v: number | null, unit: string): string {
  if (v == null) return "—";
  const n = formatNumber(v);
  const u = unit.trim();
  if (u === "R$") return `R$ ${n}`;
  if (u === "%") return `${n}%`;
  if (/^n[ºo°.]?$/i.test(u) || u.toLowerCase() === "numero" || u.toLowerCase() === "número") return n;
  return u ? `${n} ${u}` : n;
}
const parseBR = (s: string): number | null => {
  const t = s.trim(); if (t === "") return null;
  const norm = t.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(norm); return Number.isNaN(n) ? null : n;
};
const toInput = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

export function SustainabilityFarol({ kpis, members, isAdmin, currentUserId }: {
  kpis: SustKpiRow[]; members: Member[]; isAdmin: boolean; currentUserId: string;
}) {
  const [mode, setMode] = useState<"mes" | "ano">("mes");
  const [month, setMonth] = useState(nowMonth());
  const [year, setYear] = useState(nowYear());
  const [ownerId, setOwnerId] = useState("");
  const [entryKpi, setEntryKpi] = useState<SustKpiRow | null>(null);
  const [editKpi, setEditKpi] = useState<SustKpiRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const period = periodOf(month);
  const periodText = mode === "ano" ? `Ano ${year}` : monthLabel(month);

  const ownerOpts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const k of kpis) if (k.ownerId && !seen.has(k.ownerId)) seen.set(k.ownerId, k.ownerName ?? "—");
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [kpis]);

  const rows = useMemo(() => {
    const filtered = kpis.filter((k) => !ownerId || k.ownerId === ownerId).sort((a, b) => a.sort - b.sort);
    return filtered.map((k) => {
      let actual: number | null, target: number | null;
      if (mode === "ano") { const acc = accumulateYear(k, k.entries.filter((x) => x.period.startsWith(`${year}-`))); actual = acc.actual; target = acc.target; }
      else { actual = k.entries.find((x) => x.period === period)?.actual ?? null; target = k.target; }
      const { pct, status } = farolAttainment(k.direction, target ?? 0, actual);
      return { kpi: k, actual, target, pct, status };
    });
  }, [kpis, ownerId, period, mode, year]);

  const atingidos = rows.filter((r) => r.status === "atingida").length;
  const naoAtingidos = rows.filter((r) => r.status === "nao_atingida").length;
  const avaliados = rows.filter((r) => r.status !== "pendente").length;
  const pctPeriodo = avaliados > 0 ? Math.round((atingidos / avaliados) * 100) : null;
  const canEnter = (k: SustKpiRow) => isAdmin || k.ownerId === currentUserId;
  const showActions = isAdmin || rows.some((r) => canEnter(r.kpi));

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", alignItems: "flex-end", marginBottom: "1.1rem" }}>
        <div>
          <label className="label">Período</label>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <select className="select" value={mode} onChange={(e) => setMode(e.target.value as "mes" | "ano")} style={{ width: "auto" }}>
              <option value="mes">Mês</option>
              <option value="ano">Ano (acumulado)</option>
            </select>
            {mode === "mes" ? (
              <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value || nowMonth())} />
            ) : (
              <input type="number" className="input" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value || nowYear())} style={{ width: 110 }} />
            )}
          </div>
        </div>
        <div>
          <label className="label">Responsável</label>
          <select className="select" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">Todos</option>
            {ownerOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        {isAdmin && (
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
            <ImportSustainabilityDialog />
            <ExportButton
              filename="sustentabilidade.xlsx"
              sheetName="KPIs"
              headers={["Ordem KPI", "KPI", "Un. Medida", "DONO", "META", "Direção", "Cálculo acumulado"]}
              rows={[...kpis].sort((a, b) => a.sort - b.sort).map((k) => [k.sort, k.name, k.unit, k.ownerName ?? "", k.target ?? "", GOAL_DIRECTION[k.direction], CONSOLIDATION_LABEL[k.consolidation]])}
            />
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>+ Novo KPI</button>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "1rem", marginBottom: "1.2rem" }}>
          <SummaryCard label={`Atingimento · ${periodText}`} value={pctPeriodo == null ? "—" : `${pctPeriodo}%`} tone={pctPeriodo === 100 ? "green" : "neutral"} sub={`${atingidos}/${avaliados || rows.length} KPIs`} />
          <SummaryCard label="Atingidos" value={String(atingidos)} tone="green" />
          <SummaryCard label="Não atingidos" value={String(naoAtingidos)} tone="red" />
          <SummaryCard label="Pendentes" value={String(rows.length - avaliados)} tone="neutral" />
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title="Nenhum KPI" description={isAdmin ? "Importe a planilha ou use “+ Novo KPI”." : "Nenhum KPI cadastrado."} />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table metas-table">
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: "right" }}>#</th>
                <th>KPI</th>
                <th>Un. medida</th>
                <th>Responsável</th>
                <th style={{ textAlign: "right" }}>Meta</th>
                <th style={{ textAlign: "right" }}>Realizado</th>
                <th style={{ minWidth: 160 }}>Atingimento</th>
                {showActions && <th style={{ textAlign: "right" }}>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const k = r.kpi;
                return (
                  <tr key={k.id}>
                    <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{k.sort || ""}</td>
                    <td>
                      {isAdmin ? (
                        <button type="button" onClick={() => setEditKpi(k)} title="Editar KPI" style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 600, color: "var(--text)", cursor: "pointer", textAlign: "left" }}>{k.name}</button>
                      ) : <span style={{ fontWeight: 600 }}>{k.name}</span>}
                    </td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{k.unit || <span className="soft">—</span>}</td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }} title={k.ownerName ?? ""}>{k.ownerName ? shortName(k.ownerName) : <span className="soft">—</span>}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtVal(r.target, k.unit)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: VAL_COLOR[r.status] }}>{fmtVal(r.actual, k.unit)}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <div className="progress-track" style={{ flex: 1 }}><div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, r.pct ?? 0))}%`, background: BAR_COLOR[r.status] }} /></div>
                        <span style={{ fontSize: "0.8rem", fontWeight: 600, minWidth: 42, textAlign: "right", color: r.status === "pendente" ? "var(--text-muted)" : BAR_COLOR[r.status] }}>{r.pct == null ? "—" : `${r.pct}%`}</span>
                        <Badge tone={FAROL_TONE[r.status]}>{FAROL_LABEL[r.status]}</Badge>
                      </div>
                    </td>
                    {showActions && (
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <div style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center", justifyContent: "flex-end" }}>
                          {mode === "mes" && canEnter(k) && (
                            <button type="button" className="icon-btn" onClick={() => setEntryKpi(k)} title="Registrar resultado do mês">
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                            </button>
                          )}
                          {isAdmin && <DeleteKpiButton id={k.id} />}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {entryKpi && <EntryDialog kpi={entryKpi} month={month} onClose={() => setEntryKpi(null)} />}
      {editKpi && <KpiDialog mode="edit" kpi={editKpi} members={members} onClose={() => setEditKpi(null)} />}
      {addOpen && <KpiDialog mode="new" members={members} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

const TONE_FG: Record<string, string> = { green: "var(--mh-success)", amber: "var(--mh-warning)", red: "var(--mh-danger)", neutral: "var(--text)" };
function SummaryCard({ label, value, tone, sub }: { label: string; value: string; tone: string; sub?: string }) {
  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.25rem", justifyContent: "center", minHeight: 100 }}>
      <div className="soft" style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: "1.9rem", fontWeight: 800, lineHeight: 1.05, color: TONE_FG[tone] ?? "var(--text)" }}>{value}</div>
      {sub && <div className="soft" style={{ fontSize: "0.74rem" }}>{sub}</div>}
    </div>
  );
}

function DeleteKpiButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const onClick = async () => { if (!(await confirmDialog({ tone: "danger", confirmLabel: "Excluir", message: "Excluir este KPI e todos os seus resultados?" }))) return; start(async () => { await deleteSustKpi(id); router.refresh(); }); };
  return (
    <button type="button" className="icon-btn icon-btn-danger" disabled={pending} onClick={onClick} title="Excluir KPI">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
    </button>
  );
}

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 520, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>
        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>{children}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>{footer}</div>
      </div>
    </div>
  );
}

function EntryDialog({ kpi, month, onClose }: { kpi: SustKpiRow; month: string; onClose: () => void }) {
  const existing = kpi.entries.find((e) => e.period === periodOf(month));
  const isRatio = kpi.consolidation === "razao";
  const [actual, setActual] = useState(toInput(existing?.actual));
  const [num, setNum] = useState(toInput(existing?.numerator));
  const [den, setDen] = useState(toInput(existing?.denominator));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const parsed = (s: string) => parseBR(s);
  const computedActual = isRatio
    ? (() => { const n = parsed(num); const d = parsed(den); return n != null && d != null && d !== 0 ? (n / d) * (kpi.unit.trim() === "%" ? 100 : 1) : null; })()
    : parsed(actual);
  const preview = farolAttainment(kpi.direction, kpi.target ?? 0, computedActual);

  const submit = () => {
    start(async () => {
      const r = await upsertSustEntry({ kpi_id: kpi.id, period: periodOf(month), actual_value: computedActual, numerator_value: isRatio ? parsed(num) : null, denominator_value: isRatio ? parsed(den) : null });
      if (r?.error) { setError(r.error); return; }
      onClose(); router.refresh();
    });
  };
  const remove = () => start(async () => { await deleteSustEntry({ kpi_id: kpi.id, period: periodOf(month) }); onClose(); router.refresh(); });

  return (
    <Modal title={`Registrar · ${kpi.name}`} onClose={onClose} footer={<>
      {existing && <button type="button" className="btn btn-ghost" style={{ color: "var(--mh-danger)", marginRight: "auto" }} disabled={pending} onClick={remove}>Remover</button>}
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>Salvar</button>
    </>}>
      <div className="soft" style={{ fontSize: "0.82rem" }}>Competência {monthLabel(month)} · Meta {fmtVal(kpi.target, kpi.unit)} · {GOAL_DIRECTION[kpi.direction]}</div>
      {isRatio ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
          <div><label className="label">Numerador</label><input className="input" value={num} onChange={(e) => setNum(e.target.value)} inputMode="decimal" /></div>
          <div><label className="label">Denominador</label><input className="input" value={den} onChange={(e) => setDen(e.target.value)} inputMode="decimal" /></div>
        </div>
      ) : (
        <div><label className="label">Realizado</label><input className="input" value={actual} onChange={(e) => setActual(e.target.value)} inputMode="decimal" placeholder="Valor apurado no mês" /></div>
      )}
      <div className="card card-pad" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-subtle, rgba(0,0,0,0.02))" }}>
        <span className="soft" style={{ fontSize: "0.8rem" }}>Realizado / Atingimento</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <strong style={{ color: VAL_COLOR[preview.status], fontSize: "1.05rem" }}>{fmtVal(computedActual, kpi.unit)}</strong>
          <span className="soft">{preview.pct == null ? "—" : `${preview.pct}%`}</span>
          <Badge tone={FAROL_TONE[preview.status]}>{FAROL_LABEL[preview.status]}</Badge>
        </span>
      </div>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

const DIR_OPTS = Object.entries(GOAL_DIRECTION) as [Enums<"goal_direction">, string][];
const CONS_OPTS = Object.entries(CONSOLIDATION_LABEL) as [Enums<"area_consolidation">, string][];

function KpiDialog({ mode, kpi, members, onClose }: { mode: "new" | "edit"; kpi?: SustKpiRow; members: Member[]; onClose: () => void }) {
  const [name, setName] = useState(kpi?.name ?? "");
  const [ownerId, setOwnerId] = useState(kpi?.ownerId ?? "");
  const [unit, setUnit] = useState(kpi?.unit ?? "");
  const [direction, setDirection] = useState<Enums<"goal_direction">>(kpi?.direction ?? "maior_melhor");
  const [consolidation, setConsolidation] = useState<Enums<"area_consolidation">>(kpi?.consolidation ?? "soma");
  const [target, setTarget] = useState(toInput(kpi?.target));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = () => {
    if (!name.trim()) { setError("Informe o nome do KPI."); return; }
    start(async () => {
      const payload = { name: name.trim(), owner_id: ownerId || null, unit: unit.trim(), direction, consolidation, target: parseBR(target) };
      const r = mode === "edit" && kpi ? await updateSustKpi({ id: kpi.id, ...payload }) : await createSustKpi(payload);
      if (r?.error) { setError(r.error); return; }
      onClose(); router.refresh();
    });
  };

  return (
    <Modal title={mode === "edit" ? "Editar KPI" : "Novo KPI"} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{mode === "edit" ? "Salvar" : "Cadastrar"}</button>
    </>}>
      <div><label className="label">Nome do KPI</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div>
        <label className="label">Responsável</label>
        <SearchSelect options={members} value={ownerId} onChange={setOwnerId} placeholder="Buscar responsável…" emptyHint="Nenhum colaborador" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
        <div><label className="label">Un. medida</label><input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="%, N°, Un., pontos…" /></div>
        <div><label className="label">Meta</label><input className="input" value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
        <div>
          <label className="label">Direção</label>
          <select className="select" value={direction} onChange={(e) => setDirection(e.target.value as Enums<"goal_direction">)}>{DIR_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
        <div>
          <label className="label">Acumulado</label>
          <select className="select" value={consolidation} onChange={(e) => setConsolidation(e.target.value as Enums<"area_consolidation">)}>{CONS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
      </div>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}
