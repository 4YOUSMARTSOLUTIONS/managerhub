"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertRvConfig, deleteRvConfig } from "@/lib/actions/rv-config";
import { ImportRvDialog } from "@/components/ImportRvDialog";
import { ExportButton } from "@/components/ui/ExportButton";
import { confirmDialog } from "@/components/ui/confirm";
import { MonthInput } from "@/components/ui/MonthInput";

const fmtBRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const monthLabel = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const nowMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export type RvConfigRow = {
  id: string;
  scope: "position" | "user";
  positionId: string | null;
  userId: string | null;
  effectiveFrom: string; // YYYY-MM-01
  value: number;
};
export type RvPositionRef = { id: string; name: string };
export type RvMemberRef = { userId: string; name: string; positionId: string | null; positionName: string | null };

/** valor vigente para um conjunto de vigências numa competência (YYYY-MM-01) */
function currentValue(configs: RvConfigRow[], period: string): RvConfigRow | null {
  let best: RvConfigRow | null = null;
  for (const c of configs) {
    if (c.effectiveFrom <= period && (!best || c.effectiveFrom > best.effectiveFrom)) best = c;
  }
  return best;
}

export function RvConfigEditor({ positions, members, configs }: { positions: RvPositionRef[]; members: RvMemberRef[]; configs: RvConfigRow[] }) {
  const [tab, setTab] = useState<"position" | "user">("position");
  const period = `${nowMonth()}-01`;

  const byPosition = useMemo(() => {
    const m = new Map<string, RvConfigRow[]>();
    for (const c of configs) if (c.scope === "position" && c.positionId) { const a = m.get(c.positionId) ?? []; a.push(c); m.set(c.positionId, a); }
    for (const a of m.values()) a.sort((x, y) => y.effectiveFrom.localeCompare(x.effectiveFrom));
    return m;
  }, [configs]);
  const byUser = useMemo(() => {
    const m = new Map<string, RvConfigRow[]>();
    for (const c of configs) if (c.scope === "user" && c.userId) { const a = m.get(c.userId) ?? []; a.push(c); m.set(c.userId, a); }
    for (const a of m.values()) a.sort((x, y) => y.effectiveFrom.localeCompare(x.effectiveFrom));
    return m;
  }, [configs]);

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.2rem" }}>Remuneração variável (metas individuais)</h3>
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          Defina o teto mensal da RV por <strong>função</strong> ou por <strong>colaborador</strong> (exceção — sobrepõe a função; R$ 0,00 exclui da RV).
          Cada valor vale <strong>a partir da competência</strong> informada, até ser substituído por uma nova vigência.
          Quem não tiver valor configurado não recebe RV.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.4rem" }}>
        <button type="button" className={tab === "position" ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"} onClick={() => setTab("position")}>Por função</button>
        <button type="button" className={tab === "user" ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"} onClick={() => setTab("user")}>Por colaborador</button>
      </div>

      {tab === "position" ? (
        <RvScopeTable
          scope="position"
          refs={positions.map((p) => ({ id: p.id, name: p.name }))}
          rows={positions.map((p) => ({ key: p.id, title: p.name, subtitle: null, configs: byPosition.get(p.id) ?? [] }))}
          period={period}
        />
      ) : (
        <RvScopeTable
          scope="user"
          refs={members.map((m) => ({ id: m.userId, name: m.name }))}
          rows={members.map((m) => {
            const inherited = m.positionId ? currentValue(byPosition.get(m.positionId) ?? [], period) : null;
            return {
              key: m.userId,
              title: m.name,
              subtitle: `${m.positionName ?? "Sem função"}${inherited ? ` · herda ${fmtBRL(inherited.value)}` : " · sem RV da função"}`,
              configs: byUser.get(m.userId) ?? [],
            };
          })}
          period={period}
        />
      )}
    </div>
  );
}

function RvScopeTable({ scope, refs, rows, period }: {
  scope: "position" | "user";
  refs: { id: string; name: string }[];
  rows: { key: string; title: string; subtitle: string | null; configs: RvConfigRow[] }[];
  period: string;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [formFor, setFormFor] = useState<string | null>(null);
  const [month, setMonth] = useState(nowMonth());
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const filtered = rows.filter((r) => r.title.toLowerCase().includes(search.toLowerCase()));


  const toggleExpand = (k: string) => setExpanded((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const openForm = (k: string) => { setFormFor(k); setMonth(nowMonth()); setValue(""); setError(""); };

  const save = (key: string) => {
    setError("");
    if (value.trim() === "" || Number.isNaN(Number(value)) || Number(value) < 0) { setError("Informe o valor (R$)."); return; }
    start(async () => {
      const res = await upsertRvConfig({
        scope,
        position_id: scope === "position" ? key : null,
        user_id: scope === "user" ? key : null,
        effective_from: month,
        value: Number(value),
      });
      if (res.error) { setError(res.error); return; }
      setFormFor(null);
      router.refresh();
    });
  };

  const remove = async (id: string) => {
    if (!(await confirmDialog({ tone: "danger", confirmLabel: "Excluir", message: "Excluir esta vigência?" }))) return;
    start(async () => { await deleteRvConfig(id); router.refresh(); });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input className="input" placeholder={scope === "position" ? "Buscar função…" : "Buscar colaborador…"} value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
        <ImportRvDialog scope={scope} refs={refs} />
        <ExportButton
          filename={`rv_${scope === "position" ? "por_funcao" : "por_colaborador"}.xlsx`}
          sheetName="RV"
          headers={[scope === "position" ? "Função" : "Colaborador", "Competência", "Valor"]}
          rows={rows.flatMap((r) => [...r.configs].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).map((c) => [r.title, monthLabel(c.effectiveFrom), c.value]))}
        />
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>{scope === "position" ? "Função" : "Colaborador"}</th>
            <th style={{ textAlign: "right" }}>RV vigente ({monthLabel(period)})</th>
            <th style={{ textAlign: "right" }}></th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr><td colSpan={3} className="soft" style={{ textAlign: "center", padding: "1rem" }}>Nenhum item.</td></tr>
          ) : filtered.map((r) => {
            const cur = currentValue(r.configs, period);
            const isOpen = expanded.has(r.key);
            return (
              <RowGroup key={r.key}>
                <tr>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {r.configs.length > 0 ? (
                        <button type="button" onClick={() => toggleExpand(r.key)} title={isOpen ? "Ocultar vigências" : "Ver vigências"} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", width: 14, padding: 0, fontSize: "0.7rem" }}>{isOpen ? "▾" : "▸"}</button>
                      ) : <span style={{ display: "inline-block", width: 14 }} />}
                      <div>
                        <div style={{ fontWeight: 600 }}>{r.title}</div>
                        {r.subtitle && <div className="soft" style={{ fontSize: "0.72rem" }}>{r.subtitle}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 700 }}>
                    {cur ? (cur.value > 0 ? fmtBRL(cur.value) : <span className="soft">R$ 0,00 (sem RV)</span>) : <span className="soft">—</span>}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => openForm(r.key)}>+ Vigência</button>
                  </td>
                </tr>
                {formFor === r.key && (
                  <tr>
                    <td colSpan={3} style={{ background: "var(--surface-2)" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "flex-end", padding: "0.2rem 0" }}>
                        <div>
                          <label className="label">A partir de</label>
                          <MonthInput value={month} onChange={setMonth} />
                        </div>
                        <div>
                          <label className="label">Valor (R$)</label>
                          <input type="number" step="any" min={0} className="input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,00" style={{ width: 140 }} />
                        </div>
                        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => save(r.key)}>{pending ? "Salvando…" : "Salvar"}</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFormFor(null)}>Cancelar</button>
                        {error && <span style={{ color: "var(--mh-danger)", fontSize: "0.8rem" }}>{error}</span>}
                      </div>
                    </td>
                  </tr>
                )}
                {isOpen && r.configs.map((c) => (
                  <tr key={c.id}>
                    <td style={{ paddingLeft: 34 }} className="muted">
                      a partir de {monthLabel(c.effectiveFrom)}
                      {cur?.id === c.id && <span className="badge badge-green" style={{ marginLeft: 6, fontSize: "0.62rem" }}>vigente</span>}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtBRL(c.value)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button type="button" className="icon-btn icon-btn-danger" title="Excluir vigência" disabled={pending} onClick={() => remove(c.id)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </RowGroup>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// wrapper p/ agrupar <tr>s de um item sem quebrar a tabela
function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
