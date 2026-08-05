"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { MonthInput } from "@/components/ui/MonthInput";
import { YearSelect } from "@/components/ui/YearSelect";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchSelect } from "@/components/SearchSelect";
import { ImportPnrDialog } from "@/components/ImportPnrDialog";
import { ExportButton } from "@/components/ui/ExportButton";
import {
  createPnrKpi, updatePnrKpi, deletePnrKpi, upsertPnrEntry, deletePnrEntry,
} from "@/lib/actions/pnr";
import { GOAL_DIRECTION, CONSOLIDATION_LABEL, PNR_TIER_LABEL, PNR_TIER_TONE, DIRECOES_NUMERICAS } from "@/lib/constants";
import { pnrScore, type PnrTier } from "@/lib/pnr-score";
import { formatNumber, shortName } from "@/lib/format";
import type { Enums } from "@/types/database";
import { confirmDialog } from "@/components/ui/confirm";

export type PnrEntryLite = { period: string; actual: number | null; numerator: number | null; denominator: number | null };
export type PnrCategory = { id: string; name: string; sort: number; maxPoints: number | null };
export type PnrKpiRow = {
  id: string;
  categoryId: string | null;
  sort: number;
  name: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  unit: string;
  direction: Enums<"goal_direction">;
  consolidation: Enums<"area_consolidation">;
  maxPoints: number;
  target: number | null;
  partialHigh: number | null;
  partialLow: number | null;
  pointsHigh: number | null;
  pointsLow: number | null;
  entries: PnrEntryLite[];
};
export type Member = { id: string; name: string };

const TIER_COLOR: Record<PnrTier, string> = { total: "var(--mh-success)", alta: "var(--mh-warning)", baixa: "var(--mh-warning)", zero: "var(--mh-danger)", pendente: "var(--text-muted)" };

// exportação da estrutura PNR (mesmas colunas do modelo de importação)
const PNR_EXPORT_HEADERS = ["Ordem KPI", "KPI", "Conceito", "Pontuação total", "DONOS", "Un. Medida", "Meta", "Direção", "Meta Parcial Alta", "Meta Parcial Baixa", "Pontos Parcial Alta", "Pontos Parcial Baixa"];
function pnrKpiRow(k: PnrKpiRow): (string | number | null)[] {
  return [k.sort, k.name, k.description ?? "", k.maxPoints, k.ownerName ?? "", k.unit, k.target ?? "", GOAL_DIRECTION[k.direction], k.partialHigh ?? "", k.partialLow ?? "", k.pointsHigh ?? "", k.pointsLow ?? ""];
}
function pnrExportRows(categories: PnrCategory[], kpis: PnrKpiRow[]): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  const byCat = (cid: string | null) => kpis.filter((k) => k.categoryId === cid).sort((a, b) => a.sort - b.sort);
  for (const c of [...categories].sort((a, b) => a.sort - b.sort)) {
    rows.push(["-", c.name, "", c.maxPoints ?? "", "-", "-", "-", "", "-", "-", "-", "-"]);
    for (const k of byCat(c.id)) rows.push(pnrKpiRow(k));
  }
  for (const k of byCat(null)) rows.push(pnrKpiRow(k));
  return rows;
}

/**
 * Mes de abertura do farol: o ANTERIOR, nao o corrente.
 *
 * Farol mensal se apura depois que o mes fecha. Abrir no mes corrente caia num
 * periodo ainda em curso, sempre vazio, obrigando a voltar um mes toda vez.
 *
 * O setDate(1) vem ANTES de recuar: sem ele, 31 de marco menos um mes daria 3 de
 * marco, porque fevereiro nao tem dia 31 e o JavaScript transborda.
 */
function mesAnterior() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const nowYear = () => String(new Date().getFullYear());
const periodOf = (month: string) => `${month}-01`;
const monthLabel = (month: string) => { const [y, m] = month.split("-"); return `${m}/${y}`; };

// acumula os lançamentos do ano conforme a regra de cálculo do KPI.
// soma/manual: Σ realizado vs meta proporcional (meta × meses apurados);
// média: média do realizado vs meta; razão: Σnº ÷ Σtotal vs meta.
function accumulateYear(kpi: PnrKpiRow, entries: PnrEntryLite[]): { actual: number | null; target: number | null } {
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
  // soma / manual
  return {
    actual: months ? acts.reduce((s, v) => s + v, 0) : null,
    target: kpi.target != null && months ? kpi.target * months : kpi.target,
  };
}

function fmtVal(v: number | null, unit: string): string {
  if (v == null) return "—";
  const n = formatNumber(v);
  const u = unit.trim();
  if (u === "R$") return `R$ ${n}`;
  if (u === "%") return `${n}%`;
  // "Nº" indica apenas que a meta é um número — não faz sentido como sufixo
  if (/^n[ºo°.]?$/i.test(u) || u.toLowerCase() === "numero" || u.toLowerCase() === "número") return n;
  return u ? `${n} ${u}` : n;
}
const fmtPts = (v: number | null) => (v == null ? "—" : formatNumber(v));

// dica de ferramenta da coluna Meta: limiares e pontos das parciais
function parcialTip(k: { partialHigh: number | null; partialLow: number | null; pointsHigh: number | null; pointsLow: number | null }): string {
  const parts: string[] = [];
  if (k.partialHigh != null) parts.push(`Parcial alta: ${formatNumber(k.partialHigh * 100)}%${k.pointsHigh != null ? ` → ${fmtPts(k.pointsHigh)} pts` : ""}`);
  if (k.partialLow != null) parts.push(`Parcial baixa: ${formatNumber(k.partialLow * 100)}%${k.pointsLow != null ? ` → ${fmtPts(k.pointsLow)} pts` : ""}`);
  return parts.join("\n");
}

// entrada em formato brasileiro: "." separa milhar, "," separa decimal
const parseBR = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const norm = t.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(norm);
  return Number.isNaN(n) ? null : n;
};
// prefill de inputs: mostra o número com vírgula decimal (sem separador de milhar)
const toInput = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

export function PnrFarol({ categories, kpis, members, isAdmin, currentUserId }: {
  categories: PnrCategory[];
  kpis: PnrKpiRow[];
  members: Member[];
  isAdmin: boolean;
  currentUserId: string;
}) {
  const [mode, setMode] = useState<"mes" | "ano">("mes");
  const [month, setMonth] = useState(mesAnterior());
  const [year, setYear] = useState(nowYear());
  // anos que têm lançamento: entram na lista do seletor de ano
  const periodosCarregados = useMemo(() => kpis.flatMap((k) => k.entries.map((e) => e.period)), [kpis]);
  const [ownerId, setOwnerId] = useState("");
  const [entryKpi, setEntryKpi] = useState<PnrKpiRow | null>(null);
  const [editKpi, setEditKpi] = useState<PnrKpiRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const period = periodOf(month);
  const periodText = mode === "ano" ? `Ano ${year}` : monthLabel(month);

  const ownerOpts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const k of kpis) if (k.ownerId && !seen.has(k.ownerId)) seen.set(k.ownerId, k.ownerName ?? "—");
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [kpis]);

  const rows = useMemo(() => {
    const filtered = kpis.filter((k) => !ownerId || k.ownerId === ownerId);
    return filtered.map((k) => {
      if (mode === "ano") {
        const ys = k.entries.filter((x) => x.period.startsWith(`${year}-`));
        const { actual, target } = accumulateYear(k, ys);
        const { points, tier, pct } = pnrScore({ ...k, target }, actual);
        return { kpi: k, actual, target, points, tier, pct };
      }
      const e = k.entries.find((x) => x.period === period);
      const actual = e?.actual ?? null;
      const { points, tier, pct } = pnrScore(k, actual);
      return { kpi: k, actual, target: k.target, points, tier, pct };
    });
  }, [kpis, ownerId, period, mode, year]);

  // agrupa por categoria (na ordem de `categories`), + "Sem seção" ao final
  const groups = useMemo(() => {
    const byCat = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.kpi.categoryId ?? "__none__";
      const arr = byCat.get(key) ?? [];
      arr.push(r);
      byCat.set(key, arr);
    }
    const ordered = [...categories].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "pt-BR"));
    const out: { id: string; name: string; maxPoints: number | null; items: typeof rows }[] = [];
    for (const c of ordered) {
      const items = byCat.get(c.id);
      if (items && items.length) out.push({ id: c.id, name: c.name, maxPoints: c.maxPoints, items });
    }
    const none = byCat.get("__none__");
    if (none && none.length) out.push({ id: "__none__", name: "Sem seção", maxPoints: null, items: none });
    return out;
  }, [rows, categories]);

  const totalMax = rows.reduce((s, r) => s + (r.kpi.maxPoints || 0), 0);
  const totalReal = rows.reduce((s, r) => s + (r.points ?? 0), 0);
  const pctMonth = totalMax > 0 ? Math.round((totalReal / totalMax) * 100) : null;
  const canEnter = (k: PnrKpiRow) => isAdmin || k.ownerId === currentUserId;
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
              <MonthInput value={month} onChange={(v) => setMonth(v || mesAnterior())} />
            ) : (
              <YearSelect value={year} onChange={setYear} periodos={periodosCarregados} />
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
            <ImportPnrDialog />
            <ExportButton filename="pnr.xlsx" sheetName="PNR" headers={PNR_EXPORT_HEADERS} rows={pnrExportRows(categories, kpis)} />
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>+ Novo indicador</button>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "1rem", marginBottom: "1.2rem" }}>
          <SummaryCard label={`Pontuação · ${periodText}`} value={`${fmtPts(totalReal)} / ${fmtPts(totalMax)}`} tone={pctMonth === 100 ? "green" : "neutral"} sub={pctMonth == null ? undefined : `${pctMonth}% da pontuação possível`} />
          <SummaryCard label="Pontuação possível" value={fmtPts(totalMax)} tone="neutral" />
          <SummaryCard label="Pontuação real" value={fmtPts(totalReal)} tone="green" />
          <SummaryCard label="% do mês" value={pctMonth == null ? "—" : `${pctMonth}%`} tone={pctMonth === 100 ? "green" : "amber"} />
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title="Nenhum indicador" description={isAdmin ? "Importe a planilha do PNR ou use “+ Novo indicador”." : "Nenhum indicador cadastrado."} />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table metas-table">
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: "right" }}>#</th>
                <th>KPI</th>
                <th>Conceito</th>
                <th>Un. medida</th>
                <th>Responsável</th>
                <th style={{ textAlign: "right" }}>Meta</th>
                <th style={{ textAlign: "right" }}>Realizado</th>
                <th style={{ textAlign: "right" }}>Atingimento</th>
                <th style={{ textAlign: "right" }}>Pontuação total</th>
                <th style={{ textAlign: "right" }}>Pontuação real</th>
                {showActions && <th style={{ textAlign: "right" }}>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const gMax = g.items.reduce((s, r) => s + (r.kpi.maxPoints || 0), 0);
                const gReal = g.items.reduce((s, r) => s + (r.points ?? 0), 0);
                return (
                  <FragmentGroup key={g.id}>
                    <tr style={{ background: "var(--bg-subtle, rgba(0,0,0,0.03))" }}>
                      <td colSpan={8} style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.02em", fontSize: "0.72rem" }}>{g.name}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtPts(gMax)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtPts(gReal)}</td>
                      {showActions && <td />}
                    </tr>
                    {g.items.map((r) => {
                      const k = r.kpi;
                      return (
                        <tr key={k.id}>
                          <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{k.sort || ""}</td>
                          <td>
                            {isAdmin ? (
                              <button type="button" onClick={() => setEditKpi(k)} title="Editar indicador" style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 600, color: "var(--text)", cursor: "pointer", textAlign: "left" }}>{k.name}</button>
                            ) : <span style={{ fontWeight: 600 }}>{k.name}</span>}
                          </td>
                          <td className="muted" style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.85rem" }} title={k.description ?? ""}>{k.description || <span className="soft">—</span>}</td>
                          <td className="muted" style={{ whiteSpace: "nowrap" }}>{k.unit || <span className="soft">—</span>}</td>
                          <td className="muted" style={{ whiteSpace: "nowrap" }} title={k.ownerName ?? ""}>{k.ownerName ? shortName(k.ownerName) : <span className="soft">—</span>}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", cursor: parcialTip(k) ? "help" : undefined }} title={parcialTip(k)}>{fmtVal(r.target, k.unit)}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtVal(r.actual, k.unit)}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: r.pct == null ? "var(--text-muted)" : TIER_COLOR[r.tier] }}>{r.pct == null ? "—" : `${formatNumber(r.pct)}%`}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtPts(k.maxPoints)}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                              <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: TIER_COLOR[r.tier] }}>{fmtPts(r.points)}</span>
                              <Badge tone={PNR_TIER_TONE[r.tier]}>{PNR_TIER_LABEL[r.tier]}</Badge>
                            </span>
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
                  </FragmentGroup>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--border)" }}>
                <td colSpan={8} style={{ fontWeight: 800, textTransform: "uppercase", fontSize: "0.72rem" }}>Total geral</td>
                <td style={{ textAlign: "right", fontWeight: 800 }}>{fmtPts(totalMax)}</td>
                <td style={{ textAlign: "right", fontWeight: 800 }}>{fmtPts(totalReal)}</td>
                {showActions && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {entryKpi && <EntryDialog kpi={entryKpi} month={month} onClose={() => setEntryKpi(null)} />}
      {editKpi && <KpiDialog mode="edit" kpi={editKpi} categories={categories} members={members} onClose={() => setEditKpi(null)} />}
      {addOpen && <KpiDialog mode="new" categories={categories} members={members} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function FragmentGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
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
  const onClick = async () => {
    if (!(await confirmDialog({ tone: "danger", confirmLabel: "Excluir", message: "Excluir este indicador e todos os seus resultados?" }))) return;
    start(async () => { await deletePnrKpi(id); router.refresh(); });
  };
  return (
    <button type="button" className="icon-btn icon-btn-danger" disabled={pending} onClick={onClick} title="Excluir indicador">
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

function EntryDialog({ kpi, month, onClose }: { kpi: PnrKpiRow; month: string; onClose: () => void }) {
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
  const preview = pnrScore(kpi, computedActual);

  const submit = () => {
    start(async () => {
      const r = await upsertPnrEntry({
        kpi_id: kpi.id,
        period: periodOf(month),
        actual_value: computedActual,
        numerator_value: isRatio ? parsed(num) : null,
        denominator_value: isRatio ? parsed(den) : null,
      });
      if (r?.error) { setError(r.error); return; }
      onClose();
      router.refresh();
    });
  };
  const remove = () => {
    start(async () => { await deletePnrEntry({ kpi_id: kpi.id, period: periodOf(month) }); onClose(); router.refresh(); });
  };

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
        <span className="soft" style={{ fontSize: "0.8rem" }}>Pontuação calculada</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <strong style={{ color: TIER_COLOR[preview.tier], fontSize: "1.1rem" }}>{fmtPts(preview.points)}</strong>
          <Badge tone={PNR_TIER_TONE[preview.tier]}>{PNR_TIER_LABEL[preview.tier]}</Badge>
          <span className="soft" style={{ fontSize: "0.8rem" }}>de {fmtPts(kpi.maxPoints)}</span>
        </span>
      </div>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

// PNR nao usa meta de sim/nao: a lista exclui `binaria` de proposito.
const DIR_OPTS = DIRECOES_NUMERICAS.map((v) => [v, GOAL_DIRECTION[v]] as [Enums<"goal_direction">, string]);
const CONS_OPTS = Object.entries(CONSOLIDATION_LABEL) as [Enums<"area_consolidation">, string][];

function KpiDialog({ mode, kpi, categories, members, onClose }: { mode: "new" | "edit"; kpi?: PnrKpiRow; categories: PnrCategory[]; members: Member[]; onClose: () => void }) {
  const [categoryId, setCategoryId] = useState(kpi?.categoryId ?? "");
  const [name, setName] = useState(kpi?.name ?? "");
  const [description, setDescription] = useState(kpi?.description ?? "");
  const [ownerId, setOwnerId] = useState(kpi?.ownerId ?? "");
  const [unit, setUnit] = useState(kpi?.unit ?? "");
  const [direction, setDirection] = useState<Enums<"goal_direction">>(kpi?.direction ?? "maior_melhor");
  const [consolidation, setConsolidation] = useState<Enums<"area_consolidation">>(kpi?.consolidation ?? "soma");
  const [maxPoints, setMaxPoints] = useState(kpi ? toInput(kpi.maxPoints) : "");
  const [target, setTarget] = useState(toInput(kpi?.target));
  const [partialHigh, setPartialHigh] = useState(toInput(kpi?.partialHigh));
  const [partialLow, setPartialLow] = useState(toInput(kpi?.partialLow));
  const [pointsHigh, setPointsHigh] = useState(toInput(kpi?.pointsHigh));
  const [pointsLow, setPointsLow] = useState(toInput(kpi?.pointsLow));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const numOrNull = (s: string) => parseBR(s);

  const submit = () => {
    if (!name.trim()) { setError("Informe o nome do indicador."); return; }
    start(async () => {
      const payload = {
        category_id: categoryId || null,
        name: name.trim(),
        description: description.trim() || null,
        owner_id: ownerId || null,
        unit: unit.trim(),
        direction,
        consolidation,
        max_points: Number(maxPoints.replace(",", ".")) || 0,
        target: numOrNull(target),
        partial_high: numOrNull(partialHigh),
        partial_low: numOrNull(partialLow),
        points_high: numOrNull(pointsHigh),
        points_low: numOrNull(pointsLow),
      };
      const r = mode === "edit" && kpi ? await updatePnrKpi({ id: kpi.id, ...payload }) : await createPnrKpi(payload);
      if (r?.error) { setError(r.error); return; }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal title={mode === "edit" ? "Editar indicador" : "Novo indicador"} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{mode === "edit" ? "Salvar" : "Cadastrar"}</button>
    </>}>
      <div><label className="label">Nome do indicador</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label className="label">Conceito (métrica)</label><textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Como o indicador é medido / o que significa" /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
        <div>
          <label className="label">Seção</label>
          <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Sem seção</option>
            {[...categories].sort((a, b) => a.sort - b.sort).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div><label className="label">Un. medida</label><input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="%, Nº, R$…" /></div>
      </div>
      <div>
        <label className="label">Responsável</label>
        <SearchSelect options={members} value={ownerId} onChange={setOwnerId} placeholder="Buscar responsável…" emptyHint="Nenhum colaborador" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
        <div>
          <label className="label">Direção</label>
          <select className="select" value={direction} onChange={(e) => setDirection(e.target.value as Enums<"goal_direction">)}>
            {DIR_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Acumulado</label>
          <select className="select" value={consolidation} onChange={(e) => setConsolidation(e.target.value as Enums<"area_consolidation">)}>
            {CONS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
        <div><label className="label">Pontuação total</label><input className="input" value={maxPoints} onChange={(e) => setMaxPoints(e.target.value)} inputMode="decimal" /></div>
        <div><label className="label">Meta</label><input className="input" value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" /></div>
      </div>
      <div className="soft" style={{ fontSize: "0.78rem", margin: "-0.3rem 0 0" }}>Parciais em fração do atingimento (ex.: 0,98 = 98% da meta). Deixe em branco quando o KPI não tiver parcial.</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
        <div><label className="label">Parcial alta (fração)</label><input className="input" value={partialHigh} onChange={(e) => setPartialHigh(e.target.value)} inputMode="decimal" /></div>
        <div><label className="label">Pontos parcial alta</label><input className="input" value={pointsHigh} onChange={(e) => setPointsHigh(e.target.value)} inputMode="decimal" /></div>
        <div><label className="label">Parcial baixa (fração)</label><input className="input" value={partialLow} onChange={(e) => setPartialLow(e.target.value)} inputMode="decimal" /></div>
        <div><label className="label">Pontos parcial baixa</label><input className="input" value={pointsLow} onChange={(e) => setPointsLow(e.target.value)} inputMode="decimal" /></div>
      </div>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}
