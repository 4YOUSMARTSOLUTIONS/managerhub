"use client";

import { useState } from "react";
import { Section } from "@/components/ui/Section";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewTicketDialog, type SlaOpt } from "@/components/NewTicketDialog";
import { TicketPanel } from "@/components/TicketPanel";
import { deleteTicket } from "@/lib/actions/tickets";
import { TICKET_STATUS, TICKET_STATUS_TONE, PRIORITY, PRIORITY_TONE } from "@/lib/constants";
import { formatDateTime, isOverdue } from "@/lib/format";
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
                <th>Chamado</th>
                <th>Setor</th>
                <th>Categoria</th>
                <th>Prioridade</th>
                <th>Unidade</th>
                <th>Responsável</th>
                <th>Prazo</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => {
                const openish = !["resolved", "closed", "cancelled"].includes(t.status);
                return (
                  <tr key={t.id}>
                    <td className="soft" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{t.code}</td>
                    <td style={{ fontWeight: 600 }}>
                      <button type="button" onClick={() => setSelected(t)} style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 600, color: "var(--text)", cursor: "pointer", textAlign: "left" }}>
                        {t.title}
                      </button>
                      {t.attachments.length > 0 && <span className="soft" style={{ fontSize: "0.75rem", marginLeft: "0.4rem" }}>📎{t.attachments.length}</span>}
                    </td>
                    <td>{t.sectorName ? <Badge tone="purple">{t.sectorName}</Badge> : <span className="soft">—</span>}</td>
                    <td className="muted" style={{ fontSize: "0.85rem" }}>{t.categoryName ?? "—"}</td>
                    <td><Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY[t.priority]}</Badge></td>
                    <td className="muted" style={{ fontSize: "0.85rem" }}>{t.unitName ?? "—"}</td>
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
                      <Badge tone={TICKET_STATUS_TONE[t.status]}>{TICKET_STATUS[t.status]}</Badge>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(t)}>{canTreat ? "Tratar" : "Abrir"}</button>
                      {isAdmin && (
                        <form action={deleteTicket} style={{ display: "inline" }}>
                          <input type="hidden" name="id" value={t.id} />
                          <button className="btn btn-danger btn-sm" type="submit">Excluir</button>
                        </form>
                      )}
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
        canRate={!!selected && selected.requesterId === currentUserId && (selected.status === "resolved" || selected.status === "closed")}
      />
    </>
  );
}
