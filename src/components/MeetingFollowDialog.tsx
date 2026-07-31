"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, AlertTriangle } from "lucide-react";
import { getMeetingFollow, type FollowDemanda, type MeetingFollow } from "@/lib/actions/meeting-records";
import { Badge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { EFF_STATUS_LABEL, EFF_STATUS_TONE, effStatus } from "@/lib/constants";
import { formatDate, isOverdue } from "@/lib/format";
import { DemandaPanel } from "./DemandaPanel";
import type { Person } from "./PeoplePicker";

/** Dias de atraso a partir de hoje (positivo = vencida). */
function daysOverdue(due: string | null): number {
  if (!due) return 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(due + "T00:00:00");
  return Math.round((today.getTime() - d.getTime()) / 86400000);
}

/** Nome curto: primeiro + último. Ex.: "MARIANA BASTOS ALFAYA" → "MARIANA ALFAYA". */
function shortName(full: string): string {
  const p = full.trim().split(/\s+/).filter(Boolean);
  return p.length <= 1 ? full : `${p[0]} ${p[p.length - 1]}`;
}
function shortAssignees(names: string[]): string {
  return names.length > 0 ? names.map(shortName).join(", ") : "Sem responsável";
}

// ---------- Aba: Pendências (tabela em colunas) ----------
function PendingTable({ rows, onTreat }: { rows: FollowDemanda[]; onTreat: (f: FollowDemanda) => void }) {
  if (rows.length === 0) {
    return <EmptyState title="Sem pendências" description="Nenhuma ação em aberto de reuniões anteriores desta reunião." />;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            <th style={{ whiteSpace: "nowrap" }}>Ação</th>
            <th style={{ whiteSpace: "nowrap" }}>Status</th>
            <th>Descrição</th>
            <th>Responsável</th>
            <th style={{ whiteSpace: "nowrap" }}>Prazo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const eff = effStatus(f.demanda.status, f.overdue, f.pendingReqCount > 0);
            const late = daysOverdue(f.demanda.dueDate);
            return (
              <tr key={f.demanda.id}>
                <td style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{f.demanda.label}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <Badge tone={EFF_STATUS_TONE[eff]}>{EFF_STATUS_LABEL[eff]}</Badge>
                </td>
                <td style={{ minWidth: 200, maxWidth: 320 }}>{f.demanda.description}</td>
                <td className="soft" style={{ fontSize: "0.82rem", minWidth: 110, whiteSpace: "nowrap" }} title={f.demanda.assigneeNames.join(", ")}>
                  {shortAssignees(f.demanda.assigneeNames)}
                </td>
                <td
                  style={{ whiteSpace: "nowrap", fontSize: "0.82rem", color: f.overdue ? "var(--mh-danger)" : "inherit", fontWeight: f.overdue ? 600 : 400 }}
                  title={f.overdue ? `Atrasada há ${late} dia${late === 1 ? "" : "s"}` : undefined}
                >
                  {f.demanda.dueDate ? formatDate(f.demanda.dueDate) : "—"}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onTreat(f)}>Tratar</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Aba: Por responsável (barras) ----------
function AssigneeChart({ rows }: { rows: FollowDemanda[] }) {
  const data = useMemo(() => {
    // conta por pessoa; quem já concluiu a parte não entra. Atraso por pessoa =
    // não concluiu, não enviou (não "executou") e o prazo já venceu.
    const m = new Map<string, { name: string; total: number; overdue: number }>();
    for (const p of rows) {
      const states = p.demanda.assigneeStates.length
        ? p.demanda.assigneeStates
        : [{ id: "__none__", name: "Sem responsável", doneRequestedAt: null, completedAt: null }];
      for (const s of states) {
        if (s.completedAt) continue;
        const cur = m.get(s.id) ?? { name: s.name, total: 0, overdue: 0 };
        cur.total += 1;
        if (!s.doneRequestedAt && p.demanda.dueDate && isOverdue(p.demanda.dueDate)) cur.overdue += 1;
        m.set(s.id, cur);
      }
    }
    return [...m.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total);
  }, [rows]);

  if (data.length === 0) {
    return <EmptyState title="Sem pendências" description="Nada a distribuir por responsável." />;
  }
  const max = Math.max(...data.map((d) => d.total), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", paddingTop: "0.4rem" }}>
      {data.map((d, i) => (
        <div key={`${d.name}-${i}`} style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", fontSize: "0.84rem" }}>
            <span style={{ fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.name}>{shortName(d.name)}</span>
            <span className="soft" style={{ flexShrink: 0 }}>
              {d.total} pendência{d.total === 1 ? "" : "s"}{d.overdue > 0 ? ` · ${d.overdue} atrasada${d.overdue === 1 ? "" : "s"}` : ""}
            </span>
          </div>
          <div
            role="img"
            aria-label={`${d.name}: ${d.total} pendências, ${d.overdue} atrasadas`}
            style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: "var(--surface-2)", width: `${(d.total / max) * 100}%`, minWidth: 40 }}
          >
            {d.overdue > 0 && <div style={{ width: `${(d.overdue / d.total) * 100}%`, background: "var(--mh-danger)" }} />}
            {d.total - d.overdue > 0 && <div style={{ width: `${((d.total - d.overdue) / d.total) * 100}%`, background: "var(--mh-warning)" }} />}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: "1rem", fontSize: "0.76rem", paddingTop: "0.3rem" }} className="soft">
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--mh-danger)" }} />Atrasadas</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--mh-warning)" }} />No prazo</span>
      </div>
    </div>
  );
}

// ---------- Aba: Concluídas (tabela em colunas) ----------
function DoneTable({ rows }: { rows: MeetingFollow["doneSince"] }) {
  if (rows.length === 0) {
    return <EmptyState title="Nada concluído" description="Nenhuma ação foi concluída desde a reunião anterior." />;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            <th style={{ whiteSpace: "nowrap" }}>Ação</th>
            <th>Descrição</th>
            <th>Responsável</th>
            <th style={{ whiteSpace: "nowrap" }}>Concluída em</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d, i) => (
            <tr key={i}>
              <td style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                {d.code != null ? `#${d.code}` : "—"}
              </td>
              <td style={{ minWidth: 200, maxWidth: 340 }}>{d.description}</td>
              <td className="soft" style={{ fontSize: "0.82rem", minWidth: 110, whiteSpace: "nowrap" }} title={d.assigneeNames.join(", ")}>
                {shortAssignees(d.assigneeNames)}
              </td>
              <td style={{ whiteSpace: "nowrap", fontSize: "0.82rem" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", color: "var(--mh-success)" }}>
                  <Check size={14} />{d.completedAt ? formatDate(d.completedAt) : "—"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MeetingFollowDialog({
  open, onClose, seriesId, seriesName, occurrenceId, people, currentUserId, isAdmin,
}: {
  open: boolean;
  onClose: () => void;
  seriesId: string;
  seriesName: string;
  occurrenceId: string;
  people: Person[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const [data, setData] = useState<MeetingFollow | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<FollowDemanda | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    return getMeetingFollow(seriesId, occurrenceId).then((r) => { setData(r); setLoading(false); });
  }, [seriesId, occurrenceId]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    getMeetingFollow(seriesId, occurrenceId).then((r) => { if (alive) { setData(r); setLoading(false); } });
    return () => { alive = false; };
  }, [open, seriesId, occurrenceId]);

  const pending = data?.pending ?? [];
  const doneSince = data?.doneSince ?? [];
  const overdueCount = useMemo(() => pending.filter((p) => p.overdue).length, [pending]);
  const awaitingCount = useMemo(() => pending.filter((p) => p.pendingReqCount > 0).length, [pending]);

  if (!open) return null;

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 60, overflowY: "auto" }}>
        <div className="card" style={{ width: "100%", maxWidth: 760, boxShadow: "var(--mh-shadow-e3)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Follow · {seriesName}</h2>
              <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.85rem" }}>
                {loading ? "Carregando…" : `${pending.length} pendência${pending.length === 1 ? "" : "s"}${overdueCount > 0 ? ` · ${overdueCount} atrasada${overdueCount === 1 ? "" : "s"}` : ""}`}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
          </div>

          <div style={{ padding: "1.1rem 1.25rem" }}>
            {loading ? (
              <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Carregando…</p>
            ) : (
              <>
                {awaitingCount > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.83rem", color: "var(--mh-info)", background: "var(--mh-info-soft)", border: "1px solid color-mix(in srgb, var(--mh-info) 25%, transparent)", borderRadius: 8, padding: "0.5rem 0.7rem", marginBottom: "0.9rem" }}>
                    <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                    {awaitingCount} {awaitingCount === 1 ? "pendência aguarda" : "pendências aguardam"} sua decisão (prorrogação ou conclusão).
                  </div>
                )}
                <Tabs
                  tabs={[
                    { id: "pendencias", label: `Pendências · ${pending.length}`, content: <PendingTable rows={pending} onTreat={setSelected} /> },
                    { id: "responsavel", label: "Por responsável", content: <AssigneeChart rows={pending} /> },
                    { id: "concluidas", label: `Concluídas · ${doneSince.length}`, content: <DoneTable rows={doneSince} /> },
                  ]}
                />
              </>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", padding: "0.9rem 1.25rem", borderTop: "1px solid var(--border)" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
          </div>
        </div>
      </div>

      <DemandaPanel
        open={selected != null}
        onClose={() => { setSelected(null); refetch(); }}
        demanda={selected?.demanda ?? null}
        requesterId={selected?.requesterId ?? null}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        people={people}
      />
    </>
  );
}
