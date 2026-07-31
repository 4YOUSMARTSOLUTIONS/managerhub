"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { upsertCadenceRule, deleteCadenceRule } from "@/lib/actions/feedbacks";

type Opt = { id: string; name: string };
export type CadenceRule = { id: string; departmentId: string; positionId: string; cadenceDays: number };

export function FeedbackCadenceEditor({ departments, positions, rules }: {
  departments: Opt[]; positions: Opt[]; rules: CadenceRule[];
}) {
  const [dept, setDept] = useState("");
  const [pos, setPos] = useState("");
  const [days, setDays] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const deptName = (id: string) => departments.find((d) => d.id === id)?.name ?? "—";
  const posName = (id: string) => positions.find((p) => p.id === id)?.name ?? "—";

  const add = () => {
    setError(null);
    if (!dept || !pos) { setError("Selecione o setor e a função."); return; }
    start(async () => {
      const r = await upsertCadenceRule({ department_id: dept, position_id: pos, cadence_days: Number(days) || 0 });
      if (r?.error) { setError(r.error); return; }
      setDept(""); setPos(""); setDays("30"); router.refresh();
    });
  };
  const remove = (id: string) => start(async () => { await deleteCadenceRule(id); router.refresh(); });

  return (
    <div className="card" style={{ maxWidth: 760, marginBottom: "1rem" }}>
      <div style={{ padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Periodicidade por setor e função</h2>
        <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.82rem" }}>A cada quantos dias cada colaborador deve receber feedback, conforme o setor e a função. <strong>0 = essa função nesse setor não tem feedback</strong>. Sem regra = não acompanha (sem cobrança).</p>
      </div>
      <div style={{ padding: "0.9rem 1.1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label className="label">Setor</label>
          <select className="select" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">Selecione…</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        </div>
        <div>
          <label className="label">Função</label>
          <select className="select" value={pos} onChange={(e) => setPos(e.target.value)}><option value="">Selecione…</option>{positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </div>
        <div>
          <label className="label">Dias</label>
          <input type="number" min={0} max={365} className="input" value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 90 }} />
        </div>
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={add}>Salvar regra</button>
        {error && <span style={{ color: "var(--mh-danger)", fontSize: "0.82rem" }}>{error}</span>}
      </div>
      {rules.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border)", maxHeight: 380, overflowY: "auto" }}>
          <table className="table">
            <thead><tr><th>Setor</th><th>Função</th><th style={{ textAlign: "right" }}>Periodicidade</th><th style={{ textAlign: "right" }}>Ações</th></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{deptName(r.departmentId)}</td>
                  <td>{posName(r.positionId)}</td>
                  <td style={{ textAlign: "right" }}>{r.cadenceDays === 0 ? "Sem feedback" : `${r.cadenceDays} dias`}</td>
                  <td style={{ textAlign: "right" }}><button type="button" className="icon-btn icon-btn-danger" disabled={pending} onClick={() => remove(r.id)} title="Excluir" aria-label="Excluir"><Trash2 size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
