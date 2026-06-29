"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTicketSla } from "@/lib/actions/tickets";
import { PRIORITY, TICKET_SLA_UNIT } from "@/lib/constants";
import type { Enums } from "@/types/database";

type Priority = Enums<"priority_level">;
type Unit = Enums<"ticket_sla_unit">;
type Cat = { id: string; name: string; sectorName: string };
type Sla = { category_id: string; priority: Priority; sla_value: number; sla_unit: Unit };

const PRIORITIES = Object.keys(PRIORITY) as Priority[];
const UNITS = Object.keys(TICKET_SLA_UNIT) as Unit[];

type Cell = { value: string; unit: Unit };

export function TicketSlaEditor({ categories, slas }: { categories: Cat[]; slas: Sla[] }) {
  const initial = useMemo(() => {
    const map: Record<string, Cell> = {};
    for (const c of categories) {
      for (const p of PRIORITIES) {
        const found = slas.find((s) => s.category_id === c.id && s.priority === p);
        map[`${c.id}:${p}`] = found ? { value: String(found.sla_value), unit: found.sla_unit } : { value: "", unit: "horas" };
      }
    }
    return map;
  }, [categories, slas]);

  const [cells, setCells] = useState<Record<string, Cell>>(initial);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const setCell = (key: string, patch: Partial<Cell>) =>
    setCells((c) => ({ ...c, [key]: { ...c[key], ...patch } }));

  const saveCategory = (catId: string) => {
    setSavedId(null);
    setSavingId(catId);
    start(async () => {
      for (const p of PRIORITIES) {
        const cell = cells[`${catId}:${p}`];
        if (!cell || cell.value.trim() === "") continue; // sem valor = sem SLA definido
        await setTicketSla({ category_id: catId, priority: p, sla_value: Number(cell.value), sla_unit: cell.unit });
      }
      setSavingId(null);
      setSavedId(catId);
      router.refresh();
      setTimeout(() => setSavedId(null), 1800);
    });
  };

  if (categories.length === 0) {
    return (
      <div className="card" style={{ padding: "1.1rem", maxWidth: 760 }}>
        <p className="soft" style={{ margin: 0, fontSize: "0.85rem" }}>
          Nenhuma categoria cadastrada. Cadastre setores e categorias primeiro para definir os SLAs.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 760 }}>
      <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
        Defina o prazo (SLA) de cada categoria por prioridade. O prazo do chamado é calculado automaticamente a partir destes valores. Deixe em branco para não definir.
      </p>
      {categories.map((c) => (
        <div className="card" key={c.id}>
          <div style={{ padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem" }}>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>
              {c.name} <span className="soft" style={{ fontWeight: 400, fontSize: "0.82rem" }}>· {c.sectorName}</span>
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <span style={{ fontSize: "0.76rem", color: "#16a34a", opacity: savedId === c.id ? 1 : 0, transition: "opacity 0.2s" }}>✓ Salvo</span>
              <button type="button" className="btn btn-primary btn-sm" disabled={pending && savingId === c.id} onClick={() => saveCategory(c.id)}>
                {pending && savingId === c.id ? "Salvando…" : "Salvar SLA"}
              </button>
            </div>
          </div>
          <div style={{ padding: "0.6rem 1.1rem 1rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.8rem" }}>
            {PRIORITIES.map((p) => {
              const key = `${c.id}:${p}`;
              const cell = cells[key] ?? { value: "", unit: "horas" as Unit };
              return (
                <div key={p} style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <label className="label" style={{ margin: 0 }}>{PRIORITY[p]}</label>
                  <input
                    type="number"
                    min={0}
                    className="input"
                    placeholder="—"
                    value={cell.value}
                    onChange={(e) => setCell(key, { value: e.target.value })}
                  />
                  <select className="select" value={cell.unit} onChange={(e) => setCell(key, { unit: e.target.value as Unit })}>
                    {UNITS.map((u) => <option key={u} value={u}>{TICKET_SLA_UNIT[u]}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
