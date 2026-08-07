"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTicketSla, setTicketSlaMode } from "@/lib/actions/tickets";
import { PRIORITY, TICKET_SLA_UNIT } from "@/lib/constants";
import type { Enums } from "@/types/database";

type Priority = Enums<"priority_level">;
type Unit = Enums<"ticket_sla_unit">;
type SlaMode = "priority" | "category";
type Cat = { id: string; name: string; sectorName: string };
type Sla = { category_id: string; priority: Priority | null; sla_value: number; sla_unit: Unit };

const PRIORITIES = Object.keys(PRIORITY) as Priority[];
const UNITS = Object.keys(TICKET_SLA_UNIT) as Unit[];
const CAT_KEY = "__cat__"; // coluna única do modo "somente por categoria"

type Cell = { value: string; unit: Unit };

export function TicketSlaEditor({ categories, slas, mode: initialMode, canEdit = true }: {
  categories: Cat[];
  slas: Sla[];
  mode: SlaMode;
  /**
   * `false` deixa em consulta. Os campos ficam VISÍVEIS e desabilitados, e não
   * escondidos: o prazo de cada categoria é justamente o que se vem ver aqui.
   */
  canEdit?: boolean;
}) {
  const [mode, setMode] = useState<SlaMode>(initialMode);

  const initial = useMemo(() => {
    const map: Record<string, Cell> = {};
    for (const c of categories) {
      for (const p of PRIORITIES) {
        const found = slas.find((s) => s.category_id === c.id && s.priority === p);
        map[`${c.id}:${p}`] = found ? { value: String(found.sla_value), unit: found.sla_unit } : { value: "", unit: "horas" };
      }
      const cat = slas.find((s) => s.category_id === c.id && s.priority == null);
      map[`${c.id}:${CAT_KEY}`] = cat ? { value: String(cat.sla_value), unit: cat.sla_unit } : { value: "", unit: "dias_uteis" };
    }
    return map;
  }, [categories, slas]);

  // categorias sem SLA definido para o modo ativo (chamados novos ficam sem prazo)
  const missing = useMemo(() => {
    return categories.filter((c) => {
      if (mode === "category") return !slas.some((s) => s.category_id === c.id && s.priority == null);
      return PRIORITIES.some((p) => !slas.some((s) => s.category_id === c.id && s.priority === p));
    });
  }, [categories, slas, mode]);

  const [cells, setCells] = useState<Record<string, Cell>>(initial);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [modePending, startMode] = useTransition();
  // confirmação por senha para trocar o modo (afeta o cálculo de prazos)
  const [pendingMode, setPendingMode] = useState<SlaMode | null>(null);
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState("");
  const router = useRouter();

  const setCell = (key: string, patch: Partial<Cell>) =>
    setCells((c) => ({ ...c, [key]: { ...c[key], ...patch } }));

  const askChangeMode = (next: SlaMode) => { setPendingMode(next); setPw(""); setPwErr(""); };
  const confirmChangeMode = () => {
    if (pendingMode == null) return;
    if (!pw.trim()) { setPwErr("Informe a sua senha para confirmar."); return; }
    setPwErr("");
    startMode(async () => {
      const res = await setTicketSlaMode(pendingMode, pw);
      if (res.error) { setPwErr(res.error); return; }
      setMode(pendingMode);
      setPendingMode(null);
      setPw("");
      router.refresh();
    });
  };

  const saveCategory = (catId: string) => {
    setSavedId(null);
    setSavingId(catId);
    start(async () => {
      if (mode === "category") {
        const cell = cells[`${catId}:${CAT_KEY}`];
        if (cell && cell.value.trim() !== "") {
          await setTicketSla({ category_id: catId, priority: null, sla_value: Number(cell.value), sla_unit: cell.unit });
        }
      } else {
        for (const p of PRIORITIES) {
          const cell = cells[`${catId}:${p}`];
          if (!cell || cell.value.trim() === "") continue; // sem valor = sem SLA definido
          await setTicketSla({ category_id: catId, priority: p, sla_value: Number(cell.value), sla_unit: cell.unit });
        }
      }
      setSavingId(null);
      setSavedId(catId);
      router.refresh();
      setTimeout(() => setSavedId(null), 1800);
    });
  };

  const simple = mode === "category";
  const ModeSelector = (
    <div className="card card-pad" style={{ maxWidth: 760, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
      <div>
        <strong style={{ fontSize: "0.9rem" }}>SLA simples (somente por categoria)</strong>
        <p className="soft" style={{ margin: "0.15rem 0 0", fontSize: "0.8rem" }}>
          {simple
            ? "Ligado: o prazo é definido só pela categoria (a prioridade não é usada nem exibida)."
            : "Desligado: o prazo é definido por categoria e prioridade."}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={simple}
        aria-label="Alternar SLA simples"
        disabled={modePending || !canEdit}
        onClick={() => askChangeMode(simple ? "priority" : "category")}
        style={{
          position: "relative", width: 46, height: 26, borderRadius: 999, border: "none", cursor: !canEdit ? "default" : modePending ? "wait" : "pointer",
          background: simple ? "var(--mh-primary-500)" : "var(--mh-border)", transition: "background 0.15s", flexShrink: 0,
          opacity: canEdit ? 1 : 0.5,
        }}
      >
        <span style={{ position: "absolute", top: 3, left: simple ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }} />
      </button>
    </div>
  );

  const PwModal = pendingMode != null && (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "10vh 1rem", zIndex: 80, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 420, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>Confirmar mudança do SLA</h2>
          <button type="button" onClick={() => setPendingMode(null)} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>
        <div style={{ padding: "1.1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>
            {pendingMode === "category"
              ? "Você vai LIGAR o SLA simples (prazo somente por categoria)."
              : "Você vai DESLIGAR o SLA simples (prazo volta a ser por categoria e prioridade)."}
            {" "}Isso muda como os prazos dos chamados são calculados. Confirme com a sua senha.
          </p>
          <div>
            <label className="label">Sua senha</label>
            <input
              type="password"
              className="input"
              autoComplete="current-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmChangeMode(); }}
              placeholder="Digite sua senha"
              autoFocus
            />
          </div>
          {pwErr && <p style={{ color: "var(--mh-danger)", fontSize: "0.8rem", margin: 0 }}>{pwErr}</p>}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" disabled={modePending} onClick={() => setPendingMode(null)}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={modePending} onClick={confirmChangeMode}>{modePending ? "Confirmando…" : "Confirmar"}</button>
        </div>
      </div>
    </div>
  );

  if (categories.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {ModeSelector}
        <div className="card" style={{ padding: "1.1rem", maxWidth: 760 }}>
          <p className="soft" style={{ margin: 0, fontSize: "0.85rem" }}>
            Nenhuma categoria cadastrada. Cadastre setores e categorias primeiro para definir os SLAs.
          </p>
        </div>
        {PwModal}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 760 }}>
      {ModeSelector}
      {missing.length > 0 && (
        <div style={{ background: "var(--mh-warning-soft)", border: "1px solid var(--mh-warning)", borderRadius: 9, padding: "0.7rem 0.9rem", fontSize: "0.82rem" }}>
          <strong style={{ color: "var(--mh-warning)" }}>⚠ {missing.length} categoria(s) sem SLA {mode === "category" ? "definido" : "para todas as prioridades"}.</strong>
          <div className="muted" style={{ marginTop: 4 }}>
            Chamados novos {mode === "category" ? "dessas categorias" : "com uma prioridade sem SLA"} ficam <strong>sem prazo</strong> até você definir o SLA: {missing.map((c) => c.name).join(", ")}.
          </div>
        </div>
      )}
      <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
        {mode === "category"
          ? "Defina o prazo (SLA) de cada categoria. O prazo do chamado é calculado automaticamente. Deixe em branco para não definir."
          : "Defina o prazo (SLA) de cada categoria por prioridade. O prazo do chamado é calculado automaticamente a partir destes valores. Deixe em branco para não definir."}
      </p>
      {categories.map((c) => (
        <div className="card" key={c.id}>
          <div style={{ padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem" }}>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>
              {c.name} <span className="soft" style={{ fontWeight: 400, fontSize: "0.82rem" }}>· {c.sectorName}</span>
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <span style={{ fontSize: "0.76rem", color: "var(--mh-success)", opacity: savedId === c.id ? 1 : 0, transition: "opacity 0.2s" }}>✓ Salvo</span>
              {canEdit && (
                <button type="button" className="btn btn-primary btn-sm" disabled={pending && savingId === c.id} onClick={() => saveCategory(c.id)}>
                  {pending && savingId === c.id ? "Salvando…" : "Salvar SLA"}
                </button>
              )}
            </div>
          </div>
          <div style={{ padding: "0.6rem 1.1rem 1rem", display: "grid", gridTemplateColumns: mode === "category" ? "minmax(150px, 280px)" : "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.8rem" }}>
            {mode === "category" ? (() => {
              const key = `${c.id}:${CAT_KEY}`;
              const cell = cells[key] ?? { value: "", unit: "dias_uteis" as Unit };
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <label className="label" style={{ margin: 0 }}>Prazo</label>
                  <input type="number" min={0} className="input" placeholder="—" disabled={!canEdit} value={cell.value} onChange={(e) => setCell(key, { value: e.target.value })} />
                  <select className="select" disabled={!canEdit} value={cell.unit} onChange={(e) => setCell(key, { unit: e.target.value as Unit })}>
                    {UNITS.map((u) => <option key={u} value={u}>{TICKET_SLA_UNIT[u]}</option>)}
                  </select>
                </div>
              );
            })() : PRIORITIES.map((p) => {
              const key = `${c.id}:${p}`;
              const cell = cells[key] ?? { value: "", unit: "horas" as Unit };
              return (
                <div key={p} style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <label className="label" style={{ margin: 0 }}>{PRIORITY[p]}</label>
                  <input type="number" min={0} className="input" placeholder="—" disabled={!canEdit} value={cell.value} onChange={(e) => setCell(key, { value: e.target.value })} />
                  <select className="select" disabled={!canEdit} value={cell.unit} onChange={(e) => setCell(key, { unit: e.target.value as Unit })}>
                    {UNITS.map((u) => <option key={u} value={u}>{TICKET_SLA_UNIT[u]}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {PwModal}
    </div>
  );
}
