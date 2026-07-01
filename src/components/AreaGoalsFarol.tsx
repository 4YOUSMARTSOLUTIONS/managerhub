"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchSelect } from "@/components/SearchSelect";
import {
  createAreaGoal, updateAreaGoal, deleteAreaGoal, upsertAreaEntry,
} from "@/lib/actions/area-goals";
import { GOAL_DIRECTION, FAROL_LABEL, FAROL_TONE, AREA_GOAL_KIND, CONSOLIDATION_LABEL } from "@/lib/constants";
import { farolAttainment, type FarolStatus } from "@/lib/goals-farol";
import { formatNumber } from "@/lib/format";
import type { Enums } from "@/types/database";

export type AreaEntryLite = { unitId: string | null; period: string; target: number | null; actual: number | null };
export type AreaGoalRow = {
  id: string;
  name: string;
  unit: string;
  kind: Enums<"area_goal_kind">;
  direction: Enums<"goal_direction">;
  consolidation: Enums<"area_consolidation">;
  departmentId: string | null;
  departmentName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  entries: AreaEntryLite[];
};
export type Opt = { id: string; name: string };
export type Member = { id: string; name: string };

function nowMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const periodOf = (month: string) => `${month}-01`;
const monthLabel = (month: string) => { const [y, m] = month.split("-"); return `${m}/${y}`; };
const GROUP = "__grupo__";
const BAR_COLOR: Record<FarolStatus, string> = { atingida: "#16a34a", nao_atingida: "#dc2626", pendente: "transparent" };

type Resolved = { target: number | null; actual: number | null; computed: boolean };

// resolve meta/real do indicador num mês para a unidade selecionada (real ou Grupo)
function resolveValue(g: AreaGoalRow, period: string, unitSel: string): Resolved {
  if (unitSel !== GROUP) {
    const e = g.entries.find((x) => x.unitId === unitSel && x.period === period);
    return { target: e?.target ?? null, actual: e?.actual ?? null, computed: false };
  }
  if (g.consolidation === "manual") {
    const e = g.entries.find((x) => x.unitId === null && x.period === period);
    return { target: e?.target ?? null, actual: e?.actual ?? null, computed: false };
  }
  const unitEntries = g.entries.filter((x) => x.unitId !== null && x.period === period);
  const targets = unitEntries.map((x) => x.target).filter((v): v is number => v != null);
  const actuals = unitEntries.map((x) => x.actual).filter((v): v is number => v != null);
  if (g.consolidation === "media") {
    const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    return { target: avg(targets), actual: avg(actuals), computed: true };
  }
  // soma
  return {
    target: targets.length ? targets.reduce((s, v) => s + v, 0) : null,
    actual: actuals.length ? actuals.reduce((s, v) => s + v, 0) : null,
    computed: true,
  };
}

export function AreaGoalsFarol({
  goals, departments, units, members, isAdmin, currentUserId, scopedUnitId = null,
}: {
  goals: AreaGoalRow[];
  departments: Opt[];
  units: Opt[];
  members: Member[];
  isAdmin: boolean;
  currentUserId: string;
  scopedUnitId?: string | null; // unidade do filtro global (trava o seletor)
}) {
  const [deptId, setDeptId] = useState("");
  const [month, setMonth] = useState(nowMonth());
  const [unitSel, setUnitSel] = useState(scopedUnitId ?? GROUP);
  const [editGoal, setEditGoal] = useState<AreaGoalRow | null>(null);
  const [entryGoal, setEntryGoal] = useState<AreaGoalRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const period = periodOf(month);
  const showDept = !deptId; // mostra coluna Área quando "Todas"
  const filtered = useMemo(() => goals.filter((g) => !deptId || g.departmentId === deptId), [goals, deptId]);

  const rows = useMemo(
    () => filtered.map((g) => {
      const { target, actual, computed } = resolveValue(g, period, unitSel);
      const { pct, status } = farolAttainment(g.direction, target ?? 0, actual);
      return { goal: g, target, actual, pct, status, computed };
    }),
    [filtered, period, unitSel],
  );

  const stats = useMemo(() => {
    const counts: Record<FarolStatus, number> = { atingida: 0, nao_atingida: 0, pendente: 0 };
    for (const r of rows) counts[r.status] += 1;
    const accum = rows.length ? Math.round((counts.atingida / rows.length) * 100) : null;
    return { counts, accum };
  }, [rows]);

  const unitName = unitSel === GROUP ? "Grupo (consolidado)" : units.find((u) => u.id === unitSel)?.name ?? "—";
  const canEnter = (g: AreaGoalRow) => isAdmin || g.ownerId === currentUserId;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", alignItems: "flex-end", marginBottom: "1.1rem" }}>
        <div>
          <label className="label">Área</label>
          <select className="select" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
            <option value="">Todas</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Competência</label>
          <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value || nowMonth())} />
        </div>
        {!scopedUnitId && (
          <div>
            <label className="label">Unidade</label>
            <select className="select" value={unitSel} onChange={(e) => setUnitSel(e.target.value)}>
              <option value={GROUP}>Grupo (consolidado)</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}
        {isAdmin && (
          <div style={{ marginLeft: "auto" }}>
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>+ Novo indicador</button>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "1rem", marginBottom: "1.2rem" }}>
          <SummaryCard label={`Acumulado · ${monthLabel(month)}`} value={stats.accum == null ? "—" : `${stats.accum}%`} tone={stats.accum === 100 ? "green" : "neutral"} sub={`${stats.counts.atingida}/${rows.length} indicadores · ${unitName}`} />
          <SummaryCard label="Atingidos" value={String(stats.counts.atingida)} tone="green" />
          <SummaryCard label="Não atingidos" value={String(stats.counts.nao_atingida)} tone="red" />
          <SummaryCard label="Pendentes" value={String(stats.counts.pendente)} tone="gray" />
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title="Nenhum indicador" description={isAdmin ? "Use “+ Novo indicador” para cadastrar os indicadores da área." : "Nenhum indicador cadastrado para o filtro atual."} />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Indicador</th>
                {showDept && <th>Área</th>}
                <th style={{ textAlign: "right" }}>Meta</th>
                <th style={{ textAlign: "right" }}>Realizado</th>
                <th>Status</th>
                <th style={{ minWidth: 180 }}>Atingimento</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ goal: g, target, actual, pct, status, computed }) => (
                <tr key={g.id}>
                  <td>
                    {isAdmin ? (
                      <button type="button" onClick={() => setEditGoal(g)} title="Editar indicador" style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 600, color: "var(--text)", cursor: "pointer", textAlign: "left" }}>{g.name}</button>
                    ) : <span style={{ fontWeight: 600 }}>{g.name}</span>}
                    <div className="soft" style={{ fontSize: "0.74rem", display: "flex", gap: "0.35rem", alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
                      <Badge tone={g.kind === "ic" ? "blue" : "purple"}>{AREA_GOAL_KIND[g.kind]}</Badge>
                      <span>{GOAL_DIRECTION[g.direction]}{g.unit ? ` · ${g.unit}` : ""}{g.ownerName ? ` · ${g.ownerName}` : ""}</span>
                    </div>
                  </td>
                  {showDept && <td className="muted" style={{ fontSize: "0.85rem" }}>{g.departmentName ?? "—"}</td>}
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{target != null ? formatNumber(target) : "—"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{actual != null ? formatNumber(actual) : "—"}</td>
                  <td><Badge tone={FAROL_TONE[status]}>{FAROL_LABEL[status]}</Badge></td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <div className="progress-track" style={{ flex: 1 }}><div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%`, background: BAR_COLOR[status] }} /></div>
                      <span style={{ fontSize: "0.8rem", fontWeight: 600, minWidth: 42, textAlign: "right", color: status === "pendente" ? "var(--text-muted)" : BAR_COLOR[status] }}>{pct == null ? "—" : `${pct}%`}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {canEnter(g) && unitSel === GROUP && computed ? (
                      <span className="soft" style={{ fontSize: "0.76rem" }} title="Consolidado calculado — lance nas unidades">{CONSOLIDATION_LABEL[g.consolidation]}</span>
                    ) : canEnter(g) ? (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEntryGoal(g)}>Registrar</button>
                    ) : null}
                    {isAdmin && (
                      <> <DeleteGoalButton id={g.id} /></>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && <GoalDialog mode="new" departments={departments} members={members} onClose={() => setAddOpen(false)} />}
      {editGoal && <GoalDialog mode="edit" goal={editGoal} departments={departments} members={members} onClose={() => setEditGoal(null)} />}
      {entryGoal && <EntryDialog goal={entryGoal} units={units} month={month} unitSel={unitSel} onClose={() => setEntryGoal(null)} />}
    </div>
  );
}

const TONE_FG: Record<string, string> = { green: "#16a34a", red: "#dc2626", gray: "var(--text)", neutral: "var(--text)" };
function SummaryCard({ label, value, tone, sub }: { label: string; value: string; tone: string; sub?: string }) {
  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.25rem", justifyContent: "center", minHeight: 100 }}>
      <div className="soft" style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1.05, color: TONE_FG[tone] ?? "var(--text)" }}>{value}</div>
      {sub && <div className="soft" style={{ fontSize: "0.74rem" }}>{sub}</div>}
    </div>
  );
}

function DeleteGoalButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const onClick = () => {
    if (!confirm("Excluir este indicador e todos os seus registros?")) return;
    start(async () => { await deleteAreaGoal(id); router.refresh(); });
  };
  return <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={onClick}>{pending ? "Excluindo…" : "Excluir"}</button>;
}

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 500, boxShadow: "var(--shadow)" }}>
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

const KIND_OPTS = Object.entries(AREA_GOAL_KIND) as [Enums<"area_goal_kind">, string][];
const DIR_OPTS = Object.entries(GOAL_DIRECTION) as [Enums<"goal_direction">, string][];
const CONS_OPTS = Object.entries(CONSOLIDATION_LABEL) as [Enums<"area_consolidation">, string][];

function GoalDialog({ mode, goal, departments, members, onClose }: { mode: "new" | "edit"; goal?: AreaGoalRow; departments: Opt[]; members: Member[]; onClose: () => void }) {
  const [name, setName] = useState(goal?.name ?? "");
  const [unit, setUnit] = useState(goal?.unit ?? "");
  const [departmentId, setDepartmentId] = useState(goal?.departmentId ?? "");
  const [kind, setKind] = useState<Enums<"area_goal_kind">>(goal?.kind ?? "ic");
  const [direction, setDirection] = useState<Enums<"goal_direction">>(goal?.direction ?? "maior_melhor");
  const [consolidation, setConsolidation] = useState<Enums<"area_consolidation">>(goal?.consolidation ?? "soma");
  const [ownerId, setOwnerId] = useState(goal?.ownerId ?? "");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = () => {
    setError("");
    if (!name.trim()) { setError("Informe o nome do indicador."); return; }
    start(async () => {
      const payload = { department_id: departmentId || null, name, unit, kind, direction, consolidation, owner_id: ownerId || null };
      const res = mode === "edit" && goal ? await updateAreaGoal({ id: goal.id, ...payload }) : await createAreaGoal(payload);
      if (res.error) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal title={mode === "edit" ? "Editar indicador" : "Novo indicador"} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{pending ? "Salvando…" : "Salvar"}</button>
    </>}>
      <div>
        <label className="label">Indicador</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Faturamento, INAD…" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
        <div>
          <label className="label">Área</label>
          <select className="select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">—</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Unidade de medida</label>
          <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="R$, %, un…" />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.8rem" }}>
        <div>
          <label className="label">IC/IV</label>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as Enums<"area_goal_kind">)}>
            {KIND_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Direção</label>
          <select className="select" value={direction} onChange={(e) => setDirection(e.target.value as Enums<"goal_direction">)}>
            {DIR_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Consolidado (Grupo)</label>
          <select className="select" value={consolidation} onChange={(e) => setConsolidation(e.target.value as Enums<"area_consolidation">)}>
            {CONS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="label">Responsável <span className="soft">(busque pelo nome)</span></label>
        <SearchSelect options={members} value={ownerId} onChange={setOwnerId} placeholder="Buscar responsável…" emptyHint="Nenhum colaborador" />
      </div>
      {error && <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

function EntryDialog({ goal, units, month, unitSel, onClose }: { goal: AreaGoalRow; units: Opt[]; month: string; unitSel: string; onClose: () => void }) {
  const groupAllowed = goal.consolidation === "manual";
  const initialUnit = unitSel === GROUP ? (groupAllowed ? GROUP : units[0]?.id ?? "") : unitSel;
  const [u, setU] = useState(initialUnit);
  const [m, setM] = useState(month);
  const [target, setTarget] = useState("");
  const [actual, setActual] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const unitId = u === GROUP ? null : u;
    const e = goal.entries.find((x) => x.unitId === unitId && x.period === periodOf(m)) ?? null;
    setTarget(e?.target != null ? String(e.target) : "");
    setActual(e?.actual != null ? String(e.actual) : "");
  }, [u, m, goal]);

  const submit = () => {
    setError("");
    if (!u) { setError("Selecione a unidade."); return; }
    if (target.trim() === "" && actual.trim() === "") { setError("Informe a meta e/ou o realizado."); return; }
    start(async () => {
      const res = await upsertAreaEntry({
        area_goal_id: goal.id,
        unit_id: u === GROUP ? null : u,
        period: periodOf(m),
        target_value: target.trim() === "" ? null : Number(target),
        actual_value: actual.trim() === "" ? null : Number(actual),
      });
      if (res.error) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal title={`Registrar · ${goal.name}`} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{pending ? "Salvando…" : "Salvar"}</button>
    </>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
        <div>
          <label className="label">Unidade</label>
          <select className="select" value={u} onChange={(e) => setU(e.target.value)}>
            {units.map((un) => <option key={un.id} value={un.id}>{un.name}</option>)}
            {groupAllowed && <option value={GROUP}>Grupo (consolidado)</option>}
          </select>
        </div>
        <div>
          <label className="label">Competência</label>
          <input type="month" className="input" value={m} onChange={(e) => setM(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
        <div>
          <label className="label">Meta {goal.unit && <span className="soft">({goal.unit})</span>}</label>
          <input type="number" step="any" className="input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="—" />
        </div>
        <div>
          <label className="label">Realizado <span className="soft">(opc.)</span></label>
          <input type="number" step="any" className="input" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="—" />
        </div>
      </div>
      <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>{GOAL_DIRECTION[goal.direction]} — o farol compara o realizado com a meta.</p>
      {error && <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}
