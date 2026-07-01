"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PRIORITY, PRIORITY_TONE, EFF_STATUS_LABEL, EFF_STATUS_TONE, effStatus } from "@/lib/constants";
import { formatDate, isOverdue } from "@/lib/format";
import { deleteAction } from "@/lib/actions/actions";
import { ConfirmActionButton } from "@/components/ui/ConfirmActionButton";
import { ActionDialog, type Opt, type BlocoOpt, type ItemOpt, type OccOpt } from "./ActionDialog";
import { DemandaPanel, type DemandaInfo } from "./DemandaPanel";
import type { Person } from "./PeoplePicker";
import type { Enums } from "@/types/database";

export type DemandaCard = {
  id: string;
  description: string;
  status: string;
  dueDate: string | null;
  assigneeNames: string[];
  assigneeIds: string[];
  pendingCount: number;
  attachments: { id: string; filename: string; path: string }[];
};

export type ActionRow = {
  id: string;
  code: number;
  isSdpo: boolean;
  pilarName: string | null;
  blocoName: string | null;
  itemName: string | null;
  seriesName: string | null;
  occurredOn: string | null;
  kpiName: string | null;
  toolName: string | null;
  unitName: string | null;
  requesterId: string | null;
  requesterName: string | null;
  priority: Enums<"priority_level">;
  dueDate: string | null;
  demandas: DemandaCard[];
  ccNames: string[];
  attachments: { id: string; filename: string; path: string }[];
};

export function ActionsManager({
  actions, currentUserId, isAdmin, people, pilares, blocos, itens, kpis, tools, series, occurrences, units, aiEnabled,
}: {
  actions: ActionRow[];
  currentUserId: string;
  isAdmin: boolean;
  people: Person[];
  pilares: Opt[];
  blocos: BlocoOpt[];
  itens: ItemOpt[];
  kpis: Opt[];
  tools: Opt[];
  series: Opt[];
  occurrences: OccOpt[];
  units?: Opt[];
  aiEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<{ demanda: DemandaInfo; requesterId: string | null } | null>(null);

  const openPanel = (d: DemandaCard, a: ActionRow, di: number) =>
    setSelected({
      demanda: {
        id: d.id,
        label: `#${a.code}.${di + 1}`,
        description: d.description,
        status: d.status as Enums<"action_status">,
        dueDate: d.dueDate,
        priority: a.priority,
        assigneeIds: d.assigneeIds,
        assigneeNames: d.assigneeNames,
        attachments: d.attachments,
        requesterName: a.requesterName,
        ccNames: a.ccNames,
        isSdpo: a.isSdpo,
        pilarName: a.pilarName,
        blocoName: a.blocoName,
        itemName: a.itemName,
        kpiName: a.kpiName,
        toolName: a.toolName,
        seriesName: a.seriesName,
        occurredOn: a.occurredOn,
      },
      requesterId: a.requesterId,
    });

  return (
    <div>
      <PageHeader
        title="Ações"
        subtitle="Abertura e acompanhamento de ações — com demandas, responsáveis e Programa de Excelência."
        action={<button className="btn btn-primary" onClick={() => setOpen(true)}>+ Nova ação</button>}
      />

      <Section title={`${actions.length} ação(ões)`} padded={false}>
        {actions.length === 0 ? (
          <EmptyState title="Nenhuma ação" description="Crie ações para acompanhar pendências e o Programa de Excelência." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Ação</th>
                  <th>Prioridade</th>
                  <th>SDPO</th>
                  <th>Pilar</th>
                  <th>Bloco</th>
                  <th>Descrição</th>
                  <th>Responsáveis</th>
                  <th>Solicitante</th>
                  <th>Status</th>
                  <th>Prazo</th>
                  <th style={{ textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {actions.flatMap((a, ai) =>
                  a.demandas.map((d, di) => {
                    const first = di === 0;
                    const finalizada = d.status === "done" || d.status === "cancelled";
                    const st = d.status as Enums<"action_status">;
                    const overdue = !!d.dueDate && !finalizada && isOverdue(d.dueDate);
                    const eff = effStatus(st, overdue, d.pendingCount > 0);
                    return (
                      <tr key={d.id} style={{ borderTop: first && ai > 0 ? "2px solid var(--border-strong)" : undefined, opacity: d.status === "cancelled" ? 0.55 : 1 }}>
                        <td style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>#{a.code}.{di + 1}</td>
                        <td>{first && <Badge tone={PRIORITY_TONE[a.priority]}>{PRIORITY[a.priority]}</Badge>}</td>
                        <td>{first && (a.isSdpo ? <Badge tone="purple">Sim</Badge> : <span className="soft">Não</span>)}</td>
                        <td className="muted" style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.pilarName ?? ""}>{first ? (a.pilarName ?? "—") : ""}</td>
                        <td className="muted" style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.blocoName ?? ""}>{first ? (a.blocoName ?? "—") : ""}</td>
                        <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "help" }} title={d.description}>{d.description}</td>
                        <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.assigneeNames.join(", ")}>
                          {d.assigneeNames.length > 0 ? d.assigneeNames.join(", ") : <span className="soft">—</span>}
                          {d.attachments.length > 0 && <span className="soft" style={{ marginLeft: 6 }} title={`${d.attachments.length} anexo(s)`}>📎{d.attachments.length}</span>}
                        </td>
                        <td className="muted" style={{ maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.requesterName ?? ""}>
                          {first ? (a.requesterName ?? "—") : ""}
                          {first && <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: "0.62rem" }}>{a.unitName ?? "Todas"}</span>}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <Badge tone={EFF_STATUS_TONE[eff]}>{EFF_STATUS_LABEL[eff]}</Badge>
                        </td>
                        <td style={{ whiteSpace: "nowrap", color: overdue ? "#dc2626" : "var(--text-muted)" }}>{d.dueDate ? formatDate(d.dueDate) : "—"}</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <div style={{ display: "inline-flex", gap: "0.3rem", alignItems: "center", justifyContent: "flex-end" }}>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openPanel(d, a, di)}>Tratar</button>
                            {first && (
                              <ConfirmActionButton
                                action={deleteAction}
                                fields={{ id: a.id }}
                                className="icon-btn icon-btn-danger"
                                buttonTitle="Excluir ação"
                                title="Excluir ação"
                                message="Excluir esta ação e todas as suas demandas?"
                                confirmLabel="Excluir"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                              </ConfirmActionButton>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <ActionDialog
        open={open}
        onClose={() => setOpen(false)}
        people={people}
        pilares={pilares}
        blocos={blocos}
        itens={itens}
        kpis={kpis}
        tools={tools}
        series={series}
        occurrences={occurrences}
        units={units}
        aiEnabled={aiEnabled}
      />

      <DemandaPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        demanda={selected?.demanda ?? null}
        requesterId={selected?.requesterId ?? null}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        people={people}
      />
    </div>
  );
}
