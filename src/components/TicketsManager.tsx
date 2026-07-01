"use client";

import { useState } from "react";
import { Section } from "@/components/ui/Section";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewTicketDialog, type SlaOpt } from "@/components/NewTicketDialog";
import { TicketPanel } from "@/components/TicketPanel";
import { NpsRating } from "@/components/NpsRating";
import { deleteTicket } from "@/lib/actions/tickets";
import { ConfirmActionButton } from "@/components/ui/ConfirmActionButton";
import { PRIORITY, PRIORITY_TONE, ticketStatusView } from "@/lib/constants";
import { formatDateTime, isOverdue } from "@/lib/format";

const TERMINAL = ["resolved", "closed", "cancelled"];
import type { Enums } from "@/types/database";

export type Opt = { id: string; name: string };
export type CatOpt = { id: string; name: string; sectorId: string };
export type Member = { id: string; name: string };
export type TicketRow = {
  id: string;
  code: string | null;
  title: string;
  description: string | null;
  status: Enums<"ticket_status">;
  priority: Enums<"priority_level">;
  requestedPriority: Enums<"priority_level"> | null;
  dueDate: string | null;
  sectorId: string | null;
  sectorName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  unitId: string | null;
  unitName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  requesterId: string | null;
  requesterName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  updatedAt: string;
  npsScore: number | null;
  npsComment: string | null;
  attachments: { id: string; path: string; filename: string; contentType: string | null }[];
};

export function TicketsManager({
  tickets, sectors, categories, units, slas, members, currentUserId, isAdmin, canTreat,
}: {
  tickets: TicketRow[];
  sectors: Opt[];
  categories: CatOpt[];
  units: Opt[];
  slas: SlaOpt[];
  members: Member[];
  currentUserId: string;
  isAdmin: boolean;
  canTreat: boolean;
}) {
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<TicketRow | null>(null);
  const [ratingTicket, setRatingTicket] = useState<TicketRow | null>(null);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.9rem" }}>
        <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>+ Abrir chamado</button>
      </div>

      <Section title={`${tickets.length} chamado(s)`} padded={false}>
        {tickets.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Unidade</th>
                <th>Chamado</th>
                <th>Setor</th>
                <th>Categoria</th>
                <th>Prioridade</th>
                <th>Solicitante</th>
                <th>Responsável</th>
                <th>Prazo</th>
                <th>Status</th>
                <th>Conclusão / Atualiz.</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => {
                const terminal = TERMINAL.includes(t.status);
                const openish = !terminal;
                const lastDate = terminal ? (t.resolvedAt ?? t.updatedAt) : t.updatedAt;
                const sv = ticketStatusView(t.status, openish && isOverdue(t.dueDate));
                // solicitante pode avaliar quando o chamado está resolvido/fechado
                const canRate = t.requesterId === currentUserId && (t.status === "resolved" || t.status === "closed");
                return (
                  <tr key={t.id}>
                    <td className="soft" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{t.code}</td>
                    <td className="muted" style={{ fontSize: "0.85rem" }}>{t.unitName ?? "—"}</td>
                    <td style={{ fontWeight: 600 }}>
                      <button type="button" onClick={() => setSelected(t)} style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 600, color: "var(--text)", cursor: "pointer", textAlign: "left" }}>
                        {t.title}
                      </button>
                      {t.attachments.length > 0 && <span className="soft" style={{ fontSize: "0.75rem", marginLeft: "0.4rem" }}>📎{t.attachments.length}</span>}
                    </td>
                    <td>{t.sectorName ? <Badge tone="purple">{t.sectorName}</Badge> : <span className="soft">—</span>}</td>
                    <td className="muted" style={{ fontSize: "0.85rem" }}>{t.categoryName ?? "—"}</td>
                    <td><Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY[t.priority]}</Badge></td>
                    <td>
                      {t.requesterName ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
                          <Avatar name={t.requesterName} />
                          <span className="muted" style={{ fontSize: "0.85rem" }}>{t.requesterName}</span>
                        </span>
                      ) : <span className="soft">—</span>}
                    </td>
                    <td>
                      {t.assigneeName ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
                          <Avatar name={t.assigneeName} />
                          <span className="muted" style={{ fontSize: "0.85rem" }}>{t.assigneeName}</span>
                        </span>
                      ) : <span className="soft">—</span>}
                    </td>
                    <td style={{ color: openish && isOverdue(t.dueDate) ? "#dc2626" : "var(--text-muted)", whiteSpace: "nowrap", fontSize: "0.85rem" }}>{formatDateTime(t.dueDate)}</td>
                    <td>
                      <Badge tone={sv.tone}>{sv.label}</Badge>
                    </td>
                    <td className="muted" style={{ whiteSpace: "nowrap", fontSize: "0.85rem" }} title={terminal ? "Data de conclusão" : "Última atualização"}>
                      {terminal && <span style={{ color: "#059669", marginRight: 4 }}>✓</span>}
                      {formatDateTime(lastDate)}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ display: "inline-flex", gap: "0.35rem", justifyContent: "flex-end" }}>
                        {canRate && (
                          <button
                            type="button"
                            className="icon-btn"
                            title={t.npsScore != null ? `Avaliação: ${t.npsScore}/10 — clique para editar` : "Avaliar chamado"}
                            onClick={() => setRatingTicket(t)}
                            style={{ color: "#f59e0b" }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill={t.npsScore != null ? "#f59e0b" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                          </button>
                        )}
                        <button
                          type="button"
                          className="icon-btn"
                          title={canTreat ? "Tratar" : "Abrir"}
                          onClick={() => setSelected(t)}
                        >
                          {canTreat ? (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
                          ) : (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
                          )}
                        </button>
                        {isAdmin && (
                          <ConfirmActionButton
                            action={deleteTicket}
                            fields={{ id: t.id }}
                            className="icon-btn icon-btn-danger"
                            buttonTitle="Excluir"
                            title="Excluir chamado"
                            message={<>Excluir o chamado <strong>{t.title}</strong>?</>}
                            confirmLabel="Excluir"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                          </ConfirmActionButton>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState title="Nenhum chamado" description="Abra o primeiro chamado para começar." />
        )}
      </Section>

      <NewTicketDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        sectors={sectors}
        categories={categories}
        units={units}
        slas={slas}
      />
      <TicketPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        ticket={selected}
        sectors={sectors}
        categories={categories}
        members={members}
        canEdit={canTreat}
        canComment={!!selected && (canTreat || selected.requesterId === currentUserId)}
        canRate={false}
      />

      {ratingTicket && (
        <div onClick={() => setRatingTicket(null)} style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 1rem", zIndex: 70, overflowY: "auto" }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 460, boxShadow: "var(--shadow)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>Avaliar chamado {ratingTicket.code ?? ""}</h2>
              <button type="button" onClick={() => setRatingTicket(null)} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
            </div>
            <div style={{ padding: "1.1rem 1.25rem" }}>
              <div className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.6rem" }}>{ratingTicket.title}</div>
              <NpsRating ticketId={ratingTicket.id} current={ratingTicket.npsScore} currentComment={ratingTicket.npsComment} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
