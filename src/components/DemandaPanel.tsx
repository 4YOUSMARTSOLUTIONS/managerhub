"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { ACTION_STATUS, PRIORITY, PRIORITY_TONE, effStatus, assigneeEffStatus } from "@/lib/constants";
import { EffStatusBadge } from "@/components/ui/EffStatusBadge";
import { formatDate, formatDateTime, isOverdue } from "@/lib/format";
import {
  getDemandaTimeline, demandaComment, demandaRequest,
  demandaDecide, demandaReopen, demandaCancel, demandaReassign, getAttachmentUrl,
  demandaAssigneeSubmit, demandaAssigneeDecide, demandaAssigneeReopen, demandaSetProblem,
  type TimelineEvent, type PendingReq,
} from "@/lib/actions/actions";
import { PeoplePicker, type Person } from "./PeoplePicker";
import type { Enums } from "@/types/database";

export type AssigneeState = { id: string; name: string; doneRequestedAt: string | null; completedAt: string | null };

export type DemandaInfo = {
  id: string;
  label: string;
  description: string;
  status: Enums<"action_status">;
  dueDate: string | null;
  priority: Enums<"priority_level">;
  assigneeIds: string[];
  assigneeNames: string[];
  /** estado de conclusão por responsável (conclusão por pessoa) */
  assigneeStates: AssigneeState[];
  attachments: { id: string; filename: string; path: string }[];
  requesterName: string | null;
  /** Problema/diagnóstico. É do CABEÇALHO da ação: as demandas irmãs mostram o mesmo. */
  problem: string | null;
  ccNames: string[];
  isSdpo: boolean;
  pilarName: string | null;
  secaoName: string | null;
  blocoName: string | null;
  itemName: string | null;
  kpiName: string | null;
  toolName: string | null;
  seriesName: string | null;
  occurredOn: string | null;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="soft" style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: "0.85rem", marginTop: 1 }}>{children}</div>
    </div>
  );
}

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
  // o painel recebe um retrato da ação feito na hora do clique; sem estado local o
  // problema recém-salvo só apareceria ao reabrir
  const [problema, setProblema] = useState<string | null>(null);
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
      setStatus(demanda.status); setDue(demanda.dueDate); setProblema(demanda.problem);
      setReassignIds(demanda.assigneeIds);
      load(demanda.id);
    }
  }, [open, demanda]);

  if (!open || !demanda) return null;

  const isAssignee = demanda.assigneeIds.includes(currentUserId);
  const isRequester = currentUserId === requesterId;
  const canManage = isRequester || isAdmin;
  const finalizada = status === "done" || status === "cancelled";
  const overdue = !!due && !finalizada && isOverdue(due);
  const hasPendingPrazo = requests.some((r) => r.type === "prazo");
  const eff = effStatus(status, overdue, requests.length > 0);

  // a criação vira a linha de autoria no cabeçalho; o histórico fica só com o
  // que aconteceu depois (comentários e movimentações)
  const createdEvent = events.find((e) => e.type === "created");
  const timelineEvents = events.filter((e) => e.type !== "created");

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
    <button type="button" className="btn btn-ghost btn-sm" style={tone === "danger" ? { color: "var(--mh-danger)" } : undefined} onClick={() => { setMode(mode === m ? "" : m); setNote(""); setDueInput(""); }}>{label}</button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 1rem", zIndex: 65, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 640, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1.4rem 1.5rem", borderBottom: "1px solid var(--border)", gap: "0.75rem" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 700, fontSize: "0.78rem", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 7, padding: "0.06rem 0.4rem" }}>{demanda.label}</span>
              <EffStatusBadge eff={eff} overdue={overdue} />
              <Badge tone={PRIORITY_TONE[demanda.priority]}>{PRIORITY[demanda.priority]}</Badge>
              {demanda.isSdpo && <Badge tone="purple">SDPO</Badge>}
            </div>
            <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: "0.85rem 0 0", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{demanda.description}</h2>
            {/* autoria fica aqui em cima; o histórico abaixo é só de comentários */}
            {createdEvent && (
              <div className="soft" style={{ fontSize: "0.78rem", marginTop: "0.7rem" }}>
                Criada por <strong style={{ fontWeight: 600 }}>{createdEvent.actorName ?? "—"}</strong>
                {" · "}{formatDateTime(createdEvent.createdAt)}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)", flexShrink: 0 }}>×</button>
        </div>

        <div style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          {/* Problema/Diagnóstico antes da ficha: a ordem de leitura é o quê (título),
              por quê (aqui) e só então os detalhes */}
          {problema && (
            <div style={{ background: "var(--surface-2)", borderRadius: 9, borderLeft: "3px solid var(--mh-primary-500)", padding: "0.85rem 1.15rem" }}>
              <div className="soft" style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>Problema / Diagnóstico</div>
              <div style={{ fontSize: "0.88rem", marginTop: 4, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{problema}</div>
            </div>
          )}

          {/* informações da ação */}
          <div style={{ background: "var(--surface-2)", borderRadius: 9, padding: "1rem 1.15rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.9rem" }}>
            <Field label="Prazo"><span style={{ color: due && !finalizada && isOverdue(due) ? "var(--mh-danger)" : undefined }}>{due ? formatDate(due) : "—"}</span></Field>
            <Field label="Responsáveis">{demanda.assigneeNames.length > 0 ? demanda.assigneeNames.join(", ") : <span className="soft">Sem responsável</span>}</Field>
            <Field label="Solicitante">{demanda.requesterName ?? "—"}</Field>
            {(demanda.ccNames ?? []).length > 0 && <Field label="Em cópia"><span className="muted">{demanda.ccNames.join(", ")}</span></Field>}
            {demanda.isSdpo && (demanda.pilarName || demanda.secaoName || demanda.blocoName || demanda.itemName) && (
              <Field label="SDPO"><span className="muted">{[demanda.pilarName, demanda.secaoName, demanda.blocoName, demanda.itemName].filter(Boolean).join(" › ")}</span></Field>
            )}
            {demanda.kpiName && <Field label="KPI">{demanda.kpiName}</Field>}
            {demanda.toolName && <Field label="Ferramenta">{demanda.toolName}</Field>}
            {demanda.seriesName && <Field label="Reunião"><span className="muted">{demanda.seriesName}{demanda.occurredOn ? ` (${formatDate(demanda.occurredOn)})` : ""}</span></Field>}
            {demanda.attachments.length > 0 && (
              <div style={{ gridColumn: "1 / -1" }}>
                <div className="soft" style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 4 }}>Anexos</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                  {demanda.attachments.map((at) => <AttLink key={at.id} path={at.path} filename={at.filename} />)}
                </div>
              </div>
            )}
          </div>

          {/* Pedidos pendentes */}
          {requests.map((r) => (
            <div key={r.id} style={{ border: "1px solid color-mix(in srgb, var(--mh-warning) 32%, transparent)", background: "var(--mh-warning-soft)", borderRadius: 9, padding: "0.7rem 0.9rem" }}>
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

          {/* Conclusão por responsável */}
          {demanda.assigneeStates.length > 0 && (
            <div>
              <label className="label">Conclusão por responsável</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {demanda.assigneeStates.map((a) => {
                  const aEff = assigneeEffStatus(a, due, status === "cancelled");
                  const awaiting = !!a.doneRequestedAt && !a.completedAt;
                  const aOverdue = !!due && !a.completedAt && status !== "cancelled" && isOverdue(due);
                  return (
                    <div key={a.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "0.5rem 0.7rem" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{a.name}</span>
                        <EffStatusBadge eff={aEff} overdue={aOverdue} />
                      </div>
                      {a.id === currentUserId && !a.completedAt && !a.doneRequestedAt && !finalizada && (
                        <div style={{ marginTop: "0.45rem" }}>
                          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => demandaAssigneeSubmit(demanda.id))}>Concluí minha parte</button>
                        </div>
                      )}
                      {a.id === currentUserId && awaiting && (
                        <div className="soft" style={{ fontSize: "0.78rem", marginTop: 4 }}>Aguardando aprovação do solicitante.</div>
                      )}
                      {isRequester && awaiting && (
                        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.45rem", alignItems: "center", flexWrap: "wrap" }}>
                          <input className="input" placeholder="Observação (opcional)" value={mode === `adec:${a.id}` ? note : ""} onChange={(e) => { setMode(`adec:${a.id}`); setNote(e.target.value); }} style={{ flex: "1 1 180px", padding: "0.35rem 0.6rem", fontSize: "0.82rem" }} />
                          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => demandaAssigneeDecide(demanda.id, a.id, true, mode === `adec:${a.id}` ? note : ""))}>Aprovar</button>
                          <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={() => run(() => demandaAssigneeDecide(demanda.id, a.id, false, mode === `adec:${a.id}` ? note : ""))}>Reprovar</button>
                        </div>
                      )}
                      {canManage && a.completedAt && status !== "cancelled" && (
                        mode === `arop:${a.id}` ? (
                          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.45rem", alignItems: "center", flexWrap: "wrap" }}>
                            <input className="input" placeholder="Motivo (opcional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: "1 1 180px", padding: "0.35rem 0.6rem", fontSize: "0.82rem" }} />
                            <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => demandaAssigneeReopen(demanda.id, a.id, note))}>Reabrir parte</button>
                          </div>
                        ) : (
                          <div style={{ marginTop: "0.45rem" }}>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode(`arop:${a.id}`); setNote(""); }}>Reabrir parte</button>
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Ações de tratamento */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            {isAssignee && !finalizada && !hasPendingPrazo && <Btn m="prazo" label="Solicitar prorrogação" />}
            {canManage && !finalizada && <Btn m="reassign" label="Reatribuir" />}
            {canManage && !finalizada && <Btn m="cancel" label="Cancelar" tone="danger" />}
            {canManage && status === "done" && <Btn m="reopen" label="Reabrir" />}
            {/* sem gate de `finalizada`: preencher o problema de ação antiga já
                concluída é o caso de uso principal deste botão */}
            {canManage && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const aberto = mode === "problema";
                  setMode(aberto ? "" : "problema");
                  setNote(aberto ? "" : (problema ?? ""));
                  setDueInput("");
                }}
              >
                {problema ? "Editar problema" : "Informar problema"}
              </button>
            )}
          </div>

          {/* Mini-formulários */}
          {mode === "prazo" && (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <input type="date" className="input" value={dueInput} min={due ?? undefined} onChange={(e) => setDueInput(e.target.value)} style={{ width: "auto" }} />
              <input className="input" placeholder="Justificativa (opcional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: "1 1 200px" }} />
              <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => demandaRequest(demanda.id, "prazo", dueInput, note))}>Enviar pedido</button>
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
          {mode === "problema" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <textarea
                className="textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Qual problema esta ação resolve?"
                style={{ minHeight: 90 }}
              />
              <span className="soft" style={{ fontSize: "0.78rem" }}>Vale para todas as demandas desta ação.</span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={pending}
                style={{ alignSelf: "flex-start" }}
                onClick={() => {
                  const texto = note.trim();
                  run(async () => {
                    const res = await demandaSetProblem(demanda.id, note);
                    if (!res.error) setProblema(texto || null);
                    return res;
                  });
                }}
              >
                Salvar problema
              </button>
            </div>
          )}
          {mode === "reassign" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <PeoplePicker people={people} selected={reassignIds} onChange={setReassignIds} placeholder="Buscar responsável…" />
              <input className="input" placeholder="Observação (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button type="button" className="btn btn-primary btn-sm" disabled={pending} style={{ alignSelf: "flex-start" }} onClick={() => run(() => demandaReassign(demanda.id, reassignIds, note))}>Salvar responsáveis</button>
            </div>
          )}

          {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{error}</p>}

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
              {timelineEvents.length === 0 ? <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Sem eventos.</p> : timelineEvents.slice().reverse().map((e) => (
                <div key={e.id} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                  <Avatar name={e.actorName ?? "?"} userId={e.actorId} />
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
