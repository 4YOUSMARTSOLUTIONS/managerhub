"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { ACTION_STATUS, ACTION_STATUS_TONE } from "@/lib/constants";
import { formatDate, formatDateTime, isOverdue } from "@/lib/format";
import {
  getDemandaTimeline, demandaComment, demandaSetStatus, demandaRequest,
  demandaDecide, demandaReopen, demandaCancel, demandaReassign, getAttachmentUrl,
  type TimelineEvent, type PendingReq,
} from "@/lib/actions/actions";
import { PeoplePicker, type Person } from "./PeoplePicker";
import type { Enums } from "@/types/database";

export type DemandaInfo = {
  id: string;
  description: string;
  status: Enums<"action_status">;
  dueDate: string | null;
  assigneeIds: string[];
  assigneeNames: string[];
  attachments: { id: string; filename: string; path: string }[];
};

function AttLink({ path, filename }: { path: string; filename: string }) {
  const open = async () => { const url = await getAttachmentUrl(path); if (url) window.open(url, "_blank"); };
  return (
    <button type="button" onClick={open} className="reg-chip" style={{ border: "1px solid var(--border)", cursor: "pointer", fontSize: "0.78rem" }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
      {filename}
    </button>
  );
}

const EVENT_LABEL: Record<string, string> = {
  created: "criou esta ação",
  status_changed: "alterou o status",
  prazo_requested: "solicitou prorrogação de prazo",
  prazo_approved: "aprovou a prorrogação",
  prazo_rejected: "reprovou a prorrogação",
  conclusao_requested: "solicitou a conclusão",
  conclusao_approved: "aprovou a conclusão",
  conclusao_rejected: "reprovou a conclusão",
  reopened: "reabriu a ação",
  cancelled: "cancelou a ação",
  reassigned: "reatribuiu os responsáveis",
};

function eventText(e: TimelineEvent): string {
  if (e.type === "status_changed") {
    const to = (e.meta.to as Enums<"action_status">) ?? null;
    return `mudou o status para ${to ? ACTION_STATUS[to] : "—"}`;
  }
  if (e.type === "prazo_requested" && e.meta.new_due_date) return `solicitou prorrogação para ${formatDate(String(e.meta.new_due_date))}`;
  if (e.type === "prazo_approved" && e.meta.new_due_date) return `aprovou a prorrogação para ${formatDate(String(e.meta.new_due_date))}`;
  return EVENT_LABEL[e.type] ?? e.type;
}

export function DemandaPanel({
  open, onClose, demanda, requesterId, currentUserId, isAdmin, people,
}: {
  open: boolean;
  onClose: () => void;
  demanda: DemandaInfo | null;
  requesterId: string | null;
  currentUserId: string;
  isAdmin: boolean;
  people: Person[];
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [requests, setRequests] = useState<PendingReq[]>([]);
  const [status, setStatus] = useState<Enums<"action_status">>("open");
  const [due, setDue] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [mode, setMode] = useState<string>("");
  const [note, setNote] = useState("");
  const [dueInput, setDueInput] = useState("");
  const [reassignIds, setReassignIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const load = (id: string) => getDemandaTimeline(id).then((r) => { setEvents(r.events); setRequests(r.requests); setStatus(r.status); setDue(r.dueDate); });

  useEffect(() => {
    if (open && demanda) {
      setComment(""); setMode(""); setNote(""); setDueInput(""); setError("");
      setStatus(demanda.status); setDue(demanda.dueDate);
      setReassignIds(demanda.assigneeIds);
      load(demanda.id);
    }
  }, [open, demanda]);

  if (!open || !demanda) return null;

  const isAssignee = demanda.assigneeIds.includes(currentUserId);
  const isRequester = currentUserId === requesterId;
  const canManage = isRequester || isAdmin;
  const finalizada = status === "done" || status === "cancelled";

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) => {
    setError("");
    start(async () => {
      const res = await fn();
      if (res.error) { setError(res.error); return; }
      setMode(""); setNote(""); setDueInput(""); setComment("");
      await load(demanda.id);
      router.refresh();
    });
  };

  const Btn = ({ m, label, tone }: { m: string; label: string; tone?: string }) => (
    <button type="button" className="btn btn-ghost btn-sm" style={tone === "danger" ? { color: "#dc2626" } : undefined} onClick={() => { setMode(mode === m ? "" : m); setNote(""); setDueInput(""); }}>{label}</button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 1rem", zIndex: 65, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 640, boxShadow: "var(--shadow)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", gap: "0.75rem" }}>
          <div>
            <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>{demanda.description}</h2>
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", marginTop: "0.35rem", flexWrap: "wrap", fontSize: "0.82rem" }}>
              <Badge tone={ACTION_STATUS_TONE[status]}>{ACTION_STATUS[status]}</Badge>
              {due && <span className="muted" style={{ color: !finalizada && isOverdue(due) ? "#dc2626" : undefined }}>Prazo: {formatDate(due)}</span>}
              <span className="muted">{demanda.assigneeNames.join(", ") || "Sem responsável"}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1.1rem 1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          {demanda.attachments.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
              <span className="soft" style={{ fontSize: "0.78rem" }}>Anexos:</span>
              {demanda.attachments.map((at) => <AttLink key={at.id} path={at.path} filename={at.filename} />)}
            </div>
          )}

          {/* Pedidos pendentes */}
          {requests.map((r) => (
            <div key={r.id} style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 9, padding: "0.7rem 0.9rem" }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                {r.type === "prazo" ? `Pedido de prorrogação para ${r.newDueDate ? formatDate(r.newDueDate) : "—"}` : "Pedido de conclusão"}
              </div>
              <div className="muted" style={{ fontSize: "0.8rem" }}>Por {r.requestedByName ?? "—"}{r.note ? ` · ${r.note}` : ""}</div>
              {isRequester ? (
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <input className="input" placeholder="Observação (opcional)" value={mode === `dec:${r.id}` ? note : ""} onChange={(e) => { setMode(`dec:${r.id}`); setNote(e.target.value); }} style={{ flex: "1 1 200px", padding: "0.35rem 0.6rem", fontSize: "0.82rem" }} />
                  <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => demandaDecide(r.id, true, mode === `dec:${r.id}` ? note : ""))}>Aprovar</button>
                  <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={() => run(() => demandaDecide(r.id, false, mode === `dec:${r.id}` ? note : ""))}>Reprovar</button>
                </div>
              ) : <div className="soft" style={{ fontSize: "0.78rem", marginTop: 4 }}>Aguardando aprovação do solicitante.</div>}
            </div>
          ))}

          {/* Ações de tratamento */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            {isAssignee && !finalizada && (
              <>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem" }} className="muted">
                  Status
                  <select
                    className="select"
                    value={status}
                    disabled={pending}
                    onChange={(e) => run(() => demandaSetStatus(demanda.id, e.target.value as Enums<"action_status">))}
                    style={{ width: "auto", padding: "0.35rem 0.55rem", fontSize: "0.83rem" }}
                  >
                    {(["open", "in_progress", "blocked"] as Enums<"action_status">[]).map((s) => (
                      <option key={s} value={s}>{ACTION_STATUS[s]}</option>
                    ))}
                  </select>
                </label>
                <Btn m="prazo" label="Solicitar prorrogação" />
                <Btn m="conclusao" label="Solicitar conclusão" />
              </>
            )}
            {canManage && !finalizada && <Btn m="reassign" label="Reatribuir" />}
            {canManage && !finalizada && <Btn m="cancel" label="Cancelar" tone="danger" />}
            {canManage && status === "done" && <Btn m="reopen" label="Reabrir" />}
          </div>

          {/* Mini-formulários */}
          {mode === "prazo" && (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <input type="date" className="input" value={dueInput} min={due ?? undefined} onChange={(e) => setDueInput(e.target.value)} style={{ width: "auto" }} />
              <input className="input" placeholder="Justificativa (opcional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: "1 1 200px" }} />
              <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => demandaRequest(demanda.id, "prazo", dueInput, note))}>Enviar pedido</button>
            </div>
          )}
          {mode === "conclusao" && (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <input className="input" placeholder="Comentário sobre a solução (opcional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: "1 1 240px" }} />
              <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => demandaRequest(demanda.id, "conclusao", "", note))}>Solicitar conclusão</button>
            </div>
          )}
          {mode === "cancel" && (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <input className="input" placeholder="Motivo do cancelamento" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: "1 1 240px" }} />
              <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={() => run(() => demandaCancel(demanda.id, note))}>Confirmar cancelamento</button>
            </div>
          )}
          {mode === "reopen" && (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <input className="input" placeholder="Motivo da reabertura (opcional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: "1 1 240px" }} />
              <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => demandaReopen(demanda.id, note))}>Reabrir</button>
            </div>
          )}
          {mode === "reassign" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <PeoplePicker people={people} selected={reassignIds} onChange={setReassignIds} placeholder="Buscar responsável…" />
              <input className="input" placeholder="Observação (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button type="button" className="btn btn-primary btn-sm" disabled={pending} style={{ alignSelf: "flex-start" }} onClick={() => run(() => demandaReassign(demanda.id, reassignIds, note))}>Salvar responsáveis</button>
            </div>
          )}

          {error && <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0, background: "#fef2f2", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{error}</p>}

          {/* Comentário */}
          <div>
            <label className="label">Comentar</label>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
              <textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Escreva um comentário…" style={{ minHeight: 48 }} />
              <button type="button" className="btn btn-primary btn-sm" disabled={pending || !comment.trim()} onClick={() => run(() => demandaComment(demanda.id, comment))}>Enviar</button>
            </div>
          </div>

          {/* Timeline */}
          <div>
            <label className="label">Histórico</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", maxHeight: 280, overflowY: "auto" }}>
              {events.length === 0 ? <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Sem eventos.</p> : events.slice().reverse().map((e) => (
                <div key={e.id} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                  <Avatar name={e.actorName ?? "?"} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "0.83rem" }}>
                      <strong>{e.actorName ?? "—"}</strong>{" "}
                      {e.type === "comment" ? "comentou" : eventText(e)}
                      <span className="soft" style={{ fontSize: "0.74rem" }}> · {formatDateTime(e.createdAt)}</span>
                    </div>
                    {e.body && <div className="muted" style={{ fontSize: "0.83rem", marginTop: 2, whiteSpace: "pre-wrap" }}>{e.body}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0.9rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
