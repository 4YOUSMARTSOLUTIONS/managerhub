"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  createIndividualGoal, updateIndividualGoal, deleteIndividualGoal,
  upsertGoalEntry, deleteGoalEntry, setEntryWeights,
} from "@/lib/actions/individual-goals";
import { GOAL_DIRECTION, FAROL_LABEL, FAROL_TONE } from "@/lib/constants";
import { farolAttainment, type FarolStatus } from "@/lib/goals-farol";
import { formatNumber } from "@/lib/format";
import type { Enums } from "@/types/database";

export type GoalEntryLite = { period: string; target: number; actual: number | null; weight: number; note: string | null };
export type GoalRow = {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  direction: Enums<"goal_direction">;
  ownerId: string;
  ownerName: string;
  deptId: string | null;
  subdeptId: string | null;
  entries: GoalEntryLite[];
};
export type Opt = { id: string; name: string };
export type SubOpt = { id: string; name: string; departmentId: string };
export type Member = { id: string; name: string };

function nowMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function nowYear() {
  return String(new Date().getFullYear());
}
const periodOf = (month: string) => `${month}-01`;
const monthLabel = (month: string) => {
  const [y, m] = month.split("-");
  return `${m}/${y}`;
};

const BAR_COLOR: Record<FarolStatus, string> = { atingida: "#16a34a", nao_atingida: "#dc2626", pendente: "transparent" };

type Row = { goal: GoalRow; pct: number | null; status: FarolStatus; target: number | null; actual: number | null; weight: number };

export function IndividualGoalsFarol({
  goals, isAdmin, members, departments, subdepartments,
}: {
  goals: GoalRow[];
  isAdmin: boolean;
  currentUserId: string;
  members: Member[];
  departments: Opt[];
  subdepartments: SubOpt[];
}) {
  const [mode, setMode] = useState<"mes" | "ano">("mes");
  const [month, setMonth] = useState(nowMonth());
  const [year, setYear] = useState(nowYear());
  const [deptId, setDeptId] = useState("");
  const [subId, setSubId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [editGoal, setEditGoal] = useState<GoalRow | null>(null);
  const [entryGoal, setEntryGoal] = useState<GoalRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [weightsOpen, setWeightsOpen] = useState(false);

  const subOpts = useMemo(
    () => (deptId ? subdepartments.filter((s) => s.departmentId === deptId) : subdepartments),
    [subdepartments, deptId],
  );
  const ownerOpts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of goals) if (!seen.has(g.ownerId)) seen.set(g.ownerId, g.ownerName);
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [goals]);

  const filtered = useMemo(
    () => goals.filter((g) =>
      (!deptId || g.deptId === deptId) && (!subId || g.subdeptId === subId) && (!ownerId || g.ownerId === ownerId)),
    [goals, deptId, subId, ownerId],
  );

  const period = periodOf(month);

  const view = useMemo(() => {
    const counts: Record<FarolStatus, number> = { atingida: 0, nao_atingida: 0, pendente: 0 };
    const rows: Row[] = [];
    if (mode === "ano") {
      const prefix = `${year}-`;
      let tot = 0, hit = 0, aw = 0, tw = 0, allW = true;
      for (const g of filtered) {
        const ye = g.entries.filter((e) => e.period.startsWith(prefix));
        for (const e of ye) {
          tot += 1;
          const st = farolAttainment(g.direction, e.target, e.actual).status;
          counts[st] += 1;
          if (st === "atingida") hit += 1;
          if (e.weight > 0) { tw += e.weight; if (st === "atingida") aw += e.weight; }
          else allW = false;
        }
        if (ye.length === 0) continue;
        let t = 0, a = 0, has = false;
        for (const e of ye) if (e.actual != null) { t += e.target; a += e.actual; has = true; }
        const r = farolAttainment(g.direction, t, has ? a : null);
        rows.push({ goal: g, pct: r.pct, status: r.status, target: has ? t : null, actual: has ? a : null, weight: 0 });
      }
      const allWeighted = tot > 0 && allW;
      const accum = tot === 0 ? null : allWeighted && tw > 0 ? Math.round((aw / tw) * 100) : Math.round((hit / tot) * 100);
      return { rows, counts, accum, allWeighted, sub: accum == null ? "Sem registros no ano" : `${hit}/${tot} metas-mês atingidas${allWeighted ? " · ponderado" : ""}` };
    }
    for (const g of filtered) {
      const e = g.entries.find((x) => x.period === period);
      if (!e) continue;
      const r = farolAttainment(g.direction, e.target, e.actual);
      counts[r.status] += 1;
      rows.push({ goal: g, pct: r.pct, status: r.status, target: e.target, actual: e.actual, weight: e.weight });
    }
    const allWeighted = rows.length > 0 && rows.every((r) => r.weight > 0);
    let accum: number | null = null;
    if (rows.length) {
      if (allWeighted) {
        let aw = 0, tw = 0;
        for (const r of rows) { tw += r.weight; if (r.status === "atingida") aw += r.weight; }
        accum = Math.round((aw / tw) * 100);
      } else {
        accum = Math.round((rows.filter((r) => r.status === "atingida").length / rows.length) * 100);
      }
    }
    return { rows, counts, accum, allWeighted, sub: accum == null ? "Sem registros no mês" : `${counts.atingida}/${rows.length} metas atingidas${allWeighted ? " · ponderado" : ""}` };
  }, [filtered, mode, period, year]);

  const owners = useMemo(() => new Set(view.rows.map((r) => r.goal.ownerId)), [view.rows]);
  const canWeights = mode === "mes" && view.rows.length > 0 && owners.size === 1;
  const showOwner = isAdmin && owners.size > 1;
  const periodText = mode === "ano" ? `Ano ${year}` : monthLabel(month);

  // metas (indicadores) que ainda não têm registro neste mês (para "Adicionar meta")
  const addableExisting = useMemo(
    () => filtered.filter((g) => !g.entries.some((e) => e.period === period)),
    [filtered, period],
  );
  const defaultOwner = owners.size === 1 ? [...owners][0] : ownerId || "";

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", alignItems: "flex-end", marginBottom: "1.1rem" }}>
        <div>
          <label className="label">Período</label>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <select className="select" value={mode} onChange={(e) => setMode(e.target.value as "mes" | "ano")} style={{ width: "auto" }}>
              <option value="mes">Mês</option>
              <option value="ano">Ano</option>
            </select>
            {mode === "mes" ? (
              <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value || nowMonth())} />
            ) : (
              <input type="number" className="input" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value || nowYear())} style={{ width: 110 }} />
            )}
          </div>
        </div>
        {isAdmin && (
          <>
            <div>
              <label className="label">Setor</label>
              <select className="select" value={deptId} onChange={(e) => { setDeptId(e.target.value); setSubId(""); }}>
                <option value="">Todos</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Subsetor</label>
              <select className="select" value={subId} onChange={(e) => setSubId(e.target.value)}>
                <option value="">Todos</option>
                {subOpts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Colaborador</label>
              <select className="select" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">Todos</option>
                {ownerOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          </>
        )}
        {mode === "mes" && (
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn btn-ghost" disabled={!canWeights} title={canWeights ? "" : "Selecione um colaborador para distribuir pesos"} onClick={() => setWeightsOpen(true)}>Distribuir pesos</button>
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>+ Adicionar meta</button>
          </div>
        )}
      </div>

      {view.rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "1rem", marginBottom: "1.2rem" }}>
          <SummaryCard
            label={`Acumulado · ${periodText}`}
            value={view.accum == null ? "—" : `${view.accum}%`}
            tone={view.accum === 100 ? "green" : "neutral"}
            sub={view.sub}
          />
          <SummaryCard label="Metas atingidas" value={String(view.counts.atingida)} tone="green" />
          <SummaryCard label="Não atingidas" value={String(view.counts.nao_atingida)} tone="red" />
          <SummaryCard label="Pendentes" value={String(view.counts.pendente)} tone="gray" />
        </div>
      )}

      {view.rows.length === 0 ? (
        <EmptyState
          title={mode === "ano" ? "Nenhum registro no ano" : "Nenhuma meta neste mês"}
          description={mode === "ano" ? "Não há registros de metas para o ano selecionado." : "Use “+ Adicionar meta” para incluir as metas desta competência."}
        />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Meta</th>
                <th style={{ textAlign: "right" }}>Peso</th>
                {showOwner && <th>Colaborador</th>}
                <th style={{ textAlign: "right" }}>Alvo</th>
                <th style={{ textAlign: "right" }}>Realizado</th>
                <th>Status</th>
                <th style={{ minWidth: 180 }}>Atingimento</th>
                {mode === "mes" && <th style={{ textAlign: "right" }}>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {view.rows.map(({ goal: g, pct, status, target, actual, weight }) => (
                <tr key={g.id}>
                  <td>
                    <button type="button" onClick={() => setEditGoal(g)} title="Editar indicador" style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 600, color: "var(--text)", cursor: "pointer", textAlign: "left" }}>
                      {g.name}
                    </button>
                    <div className="soft" style={{ fontSize: "0.74rem" }}>
                      {GOAL_DIRECTION[g.direction]}{g.unit ? ` · ${g.unit}` : ""}
                    </div>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{mode === "mes" ? `${weight}%` : "—"}</td>
                  {showOwner && (
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                        <Avatar name={g.ownerName} /> {g.ownerName}
                      </span>
                    </td>
                  )}
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{target != null ? formatNumber(target) : "—"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{actual != null ? formatNumber(actual) : "—"}</td>
                  <td><Badge tone={FAROL_TONE[status]}>{FAROL_LABEL[status]}</Badge></td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <div className="progress-track" style={{ flex: 1 }}>
                        <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%`, background: BAR_COLOR[status] }} />
                      </div>
                      <span style={{ fontSize: "0.8rem", fontWeight: 600, minWidth: 42, textAlign: "right", color: status === "pendente" ? "var(--text-muted)" : BAR_COLOR[status] }}>
                        {pct == null ? "—" : `${pct}%`}
                      </span>
                    </div>
                  </td>
                  {mode === "mes" && (
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEntryGoal(g)}>Registrar</button>{" "}
                      <RemoveEntryButton goalId={g.id} period={period} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editGoal && <GoalDialog goal={editGoal} onClose={() => setEditGoal(null)} />}
      {entryGoal && <EntryDialog goal={entryGoal} month={month} onClose={() => setEntryGoal(null)} />}
      {addOpen && (
        <AddDialog
          period={period}
          monthLabel={monthLabel(month)}
          existing={addableExisting}
          isAdmin={isAdmin}
          members={members}
          defaultOwner={defaultOwner}
          onClose={() => setAddOpen(false)}
        />
      )}
      {weightsOpen && <WeightsDialog rows={view.rows} period={period} onClose={() => setWeightsOpen(false)} />}
    </div>
  );
}

const TONE_FG: Record<string, string> = {
  green: "#16a34a", amber: "#b45309", red: "#dc2626", gray: "var(--text)", blue: "#2563eb", purple: "#7c3aed", neutral: "var(--text)",
};

function SummaryCard({ label, value, tone, sub }: { label: string; value: string; tone: string; sub?: string }) {
  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.25rem", justifyContent: "center", minHeight: 100 }}>
      <div className="soft" style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1.05, color: TONE_FG[tone] ?? "var(--text)" }}>{value}</div>
      {sub && <div className="soft" style={{ fontSize: "0.74rem" }}>{sub}</div>}
    </div>
  );
}

function RemoveEntryButton({ goalId, period }: { goalId: string; period: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const onClick = () => {
    if (!confirm("Remover esta meta desta competência? (o indicador continua disponível para outros meses)")) return;
    start(async () => {
      await deleteGoalEntry({ goal_id: goalId, period });
      router.refresh();
    });
  };
  return (
    <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={onClick}>
      {pending ? "Removendo…" : "Remover"}
    </button>
  );
}

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 480, boxShadow: "var(--shadow)" }}>
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

const DIRECTION_OPTS = Object.entries(GOAL_DIRECTION) as [Enums<"goal_direction">, string][];

function AddDialog({ period, monthLabel, existing, isAdmin, members, defaultOwner, onClose }: {
  period: string; monthLabel: string; existing: GoalRow[]; isAdmin: boolean; members: Member[]; defaultOwner: string; onClose: () => void;
}) {
  const [sel, setSel] = useState("__new__");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [description, setDescription] = useState("");
  const [direction, setDirection] = useState<Enums<"goal_direction">>("maior_melhor");
  const [ownerId, setOwnerId] = useState(defaultOwner);
  const [target, setTarget] = useState("");
  const [actual, setActual] = useState("");
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const isNew = sel === "__new__";

  const submit = () => {
    setError("");
    if (isNew && !name.trim()) { setError("Informe o nome do indicador."); return; }
    if (target.trim() === "" || Number.isNaN(Number(target))) { setError("Informe a meta do período."); return; }
    start(async () => {
      let goalId = sel;
      if (isNew) {
        const res = await createIndividualGoal({ name, description, unit, direction, owner_id: isAdmin ? ownerId || undefined : undefined });
        if ("error" in res) { setError(res.error); return; }
        goalId = res.id;
      }
      const r = await upsertGoalEntry({
        goal_id: goalId,
        period,
        target_value: Number(target),
        actual_value: actual.trim() === "" ? null : Number(actual),
        weight: weight.trim() === "" ? 0 : Number(weight),
        note,
      });
      if (r.error) { setError(r.error); return; }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal
      title={`Adicionar meta · ${monthLabel}`}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{pending ? "Salvando…" : "Adicionar"}</button>
      </>}
    >
      <div>
        <label className="label">Indicador</label>
        <select className="select" value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="__new__">+ Novo indicador</option>
          {existing.map((g) => <option key={g.id} value={g.id}>{g.name}{isAdmin ? ` · ${g.ownerName}` : ""}</option>)}
        </select>
      </div>

      {isNew && (
        <>
          <div>
            <label className="label">Nome do indicador</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Faturamento, INAD…" />
          </div>
          <div>
            <label className="label">Descrição <span className="soft">(opcional)</span></label>
            <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
            <div>
              <label className="label">Unidade</label>
              <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="R$, %, un…" />
            </div>
            <div>
              <label className="label">Direção</label>
              <select className="select" value={direction} onChange={(e) => setDirection(e.target.value as Enums<"goal_direction">)}>
                {DIRECTION_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          {isAdmin && (
            <div>
              <label className="label">Colaborador (dono) <span className="soft">(vazio = você)</span></label>
              <select className="select" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">Você</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          )}
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.8rem" }}>
        <div>
          <label className="label">Meta</label>
          <input type="number" step="any" className="input" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <div>
          <label className="label">Realizado <span className="soft">(opc.)</span></label>
          <input type="number" step="any" className="input" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="—" />
        </div>
        <div>
          <label className="label">Peso (%)</label>
          <input type="number" step="any" min={0} max={100} className="input" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0" />
        </div>
      </div>
      <div>
        <label className="label">Observação <span className="soft">(opcional)</span></label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

function GoalDialog({ goal, onClose }: { goal: GoalRow; onClose: () => void }) {
  const [name, setName] = useState(goal.name);
  const [description, setDescription] = useState(goal.description ?? "");
  const [unit, setUnit] = useState(goal.unit);
  const [direction, setDirection] = useState<Enums<"goal_direction">>(goal.direction);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const save = () => {
    setError("");
    if (!name.trim()) { setError("Informe o nome do indicador."); return; }
    start(async () => {
      const res = await updateIndividualGoal({ id: goal.id, name, description, unit, direction });
      if (res.error) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  };
  const removeIndicator = () => {
    if (!confirm("Excluir este indicador e TODOS os seus registros em todos os meses?")) return;
    start(async () => {
      const res = await deleteIndividualGoal(goal.id);
      if (res.error) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal
      title="Editar indicador"
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-danger" style={{ marginRight: "auto" }} disabled={pending} onClick={removeIndicator}>Excluir indicador</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>{pending ? "Salvando…" : "Salvar"}</button>
      </>}
    >
      <div>
        <label className="label">Nome do indicador</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label">Descrição <span className="soft">(opcional)</span></label>
        <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
        <div>
          <label className="label">Unidade</label>
          <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="R$, %, un…" />
        </div>
        <div>
          <label className="label">Direção</label>
          <select className="select" value={direction} onChange={(e) => setDirection(e.target.value as Enums<"goal_direction">)}>
            {DIRECTION_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      {error && <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

function EntryDialog({ goal, month, onClose }: { goal: GoalRow; month: string; onClose: () => void }) {
  const [m, setM] = useState(month);
  const [target, setTarget] = useState("");
  const [actual, setActual] = useState("");
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const e = goal.entries.find((x) => x.period === periodOf(m)) ?? null;
    setTarget(e ? String(e.target) : "");
    setActual(e?.actual != null ? String(e.actual) : "");
    setWeight(e ? String(e.weight) : "");
    setNote(e?.note ?? "");
  }, [m, goal]);

  const submit = () => {
    setError("");
    if (!m) { setError("Informe a competência."); return; }
    if (target.trim() === "" || Number.isNaN(Number(target))) { setError("Informe a meta do período."); return; }
    start(async () => {
      const res = await upsertGoalEntry({
        goal_id: goal.id,
        period: periodOf(m),
        target_value: Number(target),
        actual_value: actual.trim() === "" ? null : Number(actual),
        weight: weight.trim() === "" ? 0 : Number(weight),
        note,
      });
      if (res.error) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal
      title={`Registrar · ${goal.name}`}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{pending ? "Salvando…" : "Salvar"}</button>
      </>}
    >
      <div>
        <label className="label">Competência</label>
        <input type="month" className="input" value={m} onChange={(e) => setM(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.8rem" }}>
        <div>
          <label className="label">Meta {goal.unit && <span className="soft">({goal.unit})</span>}</label>
          <input type="number" step="any" className="input" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <div>
          <label className="label">Realizado <span className="soft">(opc.)</span></label>
          <input type="number" step="any" className="input" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="—" />
        </div>
        <div>
          <label className="label">Peso (%)</label>
          <input type="number" step="any" min={0} max={100} className="input" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0" />
        </div>
      </div>
      <div>
        <label className="label">Observação <span className="soft">(opcional)</span></label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
        {GOAL_DIRECTION[goal.direction]} — o farol compara o realizado com a meta desta competência.
      </p>
      {error && <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

function WeightsDialog({ rows, period, onClose }: { rows: Row[]; period: string; onClose: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.goal.id, String(r.weight ?? 0)])));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const total = Math.round(rows.reduce((s, r) => s + (Number(vals[r.goal.id]) || 0), 0));

  const submit = () => {
    setError("");
    if (total !== 100) { setError(`A soma deve ser 100% (atual: ${total}%).`); return; }
    start(async () => {
      const res = await setEntryWeights({ period, weights: rows.map((r) => ({ goal_id: r.goal.id, weight: Number(vals[r.goal.id]) || 0 })) });
      if (res.error) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal
      title="Distribuir pesos do mês"
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={pending || total !== 100} onClick={submit}>{pending ? "Salvando…" : "Salvar"}</button>
      </>}
    >
      <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Defina o peso de cada meta desta competência. A soma precisa ser exatamente 100%.</p>
      {rows.map((r) => (
        <div key={r.goal.id} style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: "0.6rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.88rem" }}>{r.goal.name}</span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
            <input type="number" min={0} max={100} step="any" className="input" value={vals[r.goal.id] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [r.goal.id]: e.target.value }))} />
            <span className="soft" style={{ fontSize: "0.8rem" }}>%</span>
          </div>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: "0.6rem", fontWeight: 700 }}>
        <span>Total</span>
        <span style={{ color: total === 100 ? "#16a34a" : "#dc2626" }}>{total}%</span>
      </div>
      {error && <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}
