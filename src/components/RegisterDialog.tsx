"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerOccurrence } from "@/lib/actions/meeting-records";
import { PERIODICITY } from "@/lib/constants";
import { Avatar } from "@/components/ui/Avatar";
import { PeoplePicker, type Person } from "./PeoplePicker";
import { TorView } from "./TorView";
import type { SeriesData } from "./SeriesDialog";

type ActionRow = { title: string; assignee_id: string; due_date: string };

export function RegisterDialog({
  open,
  onClose,
  people,
  series,
}: {
  open: boolean;
  onClose: () => void;
  people: Person[];
  series?: SeriesData;
}) {
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const [occurredOn, setOccurredOn] = useState("");
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const [attendees, setAttendees] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [decisions, setDecisions] = useState("");
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [advance, setAdvance] = useState(true);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (open && series) {
      const ids = series.participantIds;
      setAttendees(ids);
      setPresent(Object.fromEntries(ids.map((id) => [id, true])));
      setOccurredOn(series.nextDate ?? new Date().toISOString().slice(0, 10));
      setNotes(""); setDecisions(""); setActions([]); setError("");
      setAdvance(series.periodicity !== "sob_demanda");
    }
  }, [open, series]);

  if (!open || !series) return null;

  const onAttendeesChange = (ids: string[]) => {
    setAttendees(ids);
    setPresent((prev) => {
      const next: Record<string, boolean> = {};
      for (const id of ids) next[id] = prev[id] ?? true;
      return next;
    });
  };

  const addAction = () => setActions((a) => [...a, { title: "", assignee_id: "", due_date: "" }]);
  const setAction = (i: number, patch: Partial<ActionRow>) =>
    setActions((a) => a.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const removeAction = (i: number) => setActions((a) => a.filter((_, idx) => idx !== i));

  const presentCount = attendees.filter((id) => present[id]).length;

  const submit = () => {
    setError("");
    start(async () => {
      const res = await registerOccurrence({
        series_id: series.id,
        occurred_on: occurredOn,
        notes,
        decisions,
        advance_next: advance,
        attendance: attendees.map((id) => ({ user_id: id, present: !!present[id] })),
        actions: actions.filter((a) => a.title.trim()),
      });
      if (res.error) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 620, boxShadow: "var(--shadow)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <div>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Registrar reunião</h2>
            <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.85rem" }}>{series.name} · {PERIODICITY[series.periodicity as keyof typeof PERIODICITY]}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: "0.8rem", alignItems: "end" }}>
            <div>
              <label className="label">Data da reunião</label>
              <input type="date" className="input" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
            </div>
          </div>

          <details style={{ background: "var(--surface-2)", borderRadius: 9, padding: "0.6rem 0.9rem" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, color: "var(--text-muted)" }}>Ver TOR da reunião</summary>
            <div style={{ marginTop: "0.8rem" }}>
              <TorView series={series} participantNames={attendees.map((id) => byId.get(id)?.name ?? "—")} />
            </div>
          </details>

          <div>
            <label className="label">Presença · {presentCount}/{attendees.length} presentes</label>
            {attendees.length > 0 && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 9, maxHeight: 220, overflowY: "auto", marginBottom: "0.5rem" }}>
                {attendees.map((id) => {
                  const p = byId.get(id);
                  return (
                    <label key={id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: "0.85rem" }}>
                      <input type="checkbox" checked={!!present[id]} onChange={(e) => setPresent((prev) => ({ ...prev, [id]: e.target.checked }))} />
                      <Avatar name={p?.name ?? "?"} />
                      <span style={{ flex: 1 }}>{p?.name ?? "—"}</span>
                      <span className="soft" style={{ fontSize: "0.75rem" }}>{present[id] ? "Presente" : "Ausente"}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <PeoplePicker people={people} selected={attendees} onChange={onAttendeesChange} placeholder="Adicionar participante…" />
          </div>

          <div>
            <label className="label">Anotações</label>
            <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Resumo, discussões e pontos tratados…" />
          </div>

          <div>
            <label className="label">Decisões</label>
            <textarea className="textarea" value={decisions} onChange={(e) => setDecisions(e.target.value)} placeholder="Deliberações tomadas na reunião…" style={{ minHeight: 60 }} />
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
              <label className="label" style={{ margin: 0 }}>Ações geradas</label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={addAction}>+ Ação</button>
            </div>
            {actions.length === 0 ? (
              <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Nenhuma ação. Estas viram tarefas no módulo de Ações.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {actions.map((a, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 150px 140px 32px", gap: "0.4rem", alignItems: "center" }}>
                    <input className="input" placeholder="O que fazer" value={a.title} onChange={(e) => setAction(i, { title: e.target.value })} />
                    <select className="select" value={a.assignee_id} onChange={(e) => setAction(i, { assignee_id: e.target.value })}>
                      <option value="">Responsável…</option>
                      {attendees.map((id) => <option key={id} value={id}>{byId.get(id)?.name ?? "—"}</option>)}
                    </select>
                    <input type="date" className="input" value={a.due_date} onChange={(e) => setAction(i, { due_date: e.target.value })} />
                    <button type="button" className="icon-btn icon-btn-danger" onClick={() => removeAction(i)} title="Remover" style={{ width: 32, height: 32 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {series.periodicity !== "sob_demanda" && (
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
              <input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} />
              Avançar automaticamente a próxima reunião ({PERIODICITY[series.periodicity as keyof typeof PERIODICITY].toLowerCase()})
            </label>
          )}

          {error && <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0, background: "#fef2f2", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{error}</p>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>
            {pending ? "Registrando…" : "Registrar reunião"}
          </button>
        </div>
      </div>
    </div>
  );
}
