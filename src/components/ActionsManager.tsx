"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineStatus } from "@/components/ui/InlineStatus";
import { ACTION_STATUS, ACTION_STATUS_TONE, options } from "@/lib/constants";
import { formatDate, isOverdue } from "@/lib/format";
import { setDemandaStatus, deleteAction, getAttachmentUrl } from "@/lib/actions/actions";
import { ActionDialog, type Opt, type BlocoOpt, type ItemOpt, type OccOpt } from "./ActionDialog";
import type { Person } from "./PeoplePicker";
import type { Enums } from "@/types/database";

export type ActionRow = {
  id: string;
  isSdpo: boolean;
  pilarName: string | null;
  blocoName: string | null;
  itemName: string | null;
  seriesName: string | null;
  occurredOn: string | null;
  kpiName: string | null;
  toolName: string | null;
  requesterName: string | null;
  dueDate: string | null;
  demandas: { id: string; description: string; status: string; assigneeNames: string[]; attachments: { id: string; filename: string; path: string }[] }[];
  ccNames: string[];
  attachments: { id: string; filename: string; path: string }[];
};

function AttachmentLink({ path, filename }: { path: string; filename: string }) {
  const open = async () => {
    const url = await getAttachmentUrl(path);
    if (url) window.open(url, "_blank");
  };
  return (
    <button type="button" onClick={open} className="reg-chip" style={{ border: "1px solid var(--border)", cursor: "pointer", fontSize: "0.8rem" }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
      {filename}
    </button>
  );
}

export function ActionsManager({
  actions, people, pilares, blocos, itens, kpis, tools, series, occurrences,
}: {
  actions: ActionRow[];
  people: Person[];
  pilares: Opt[];
  blocos: BlocoOpt[];
  itens: ItemOpt[];
  kpis: Opt[];
  tools: Opt[];
  series: Opt[];
  occurrences: OccOpt[];
}) {
  const [open, setOpen] = useState(false);

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
          <div style={{ display: "flex", flexDirection: "column" }}>
            {actions.map((a) => (
              <div key={a.id} style={{ padding: "1rem 1.1rem", borderBottom: "1px solid var(--border)" }}>
                {/* cabeçalho */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
                    {a.isSdpo && <Badge tone="purple">SDPO</Badge>}
                    {a.isSdpo && (a.pilarName || a.blocoName || a.itemName) && (
                      <span className="soft" style={{ fontSize: "0.8rem" }}>
                        {[a.pilarName, a.blocoName, a.itemName].filter(Boolean).join(" › ")}
                      </span>
                    )}
                    {a.kpiName && <Badge tone="blue">KPI: {a.kpiName}</Badge>}
                    {a.toolName && <Badge tone="gray">{a.toolName}</Badge>}
                  </div>
                  <form action={deleteAction}>
                    <input type="hidden" name="id" value={a.id} />
                    <button className="icon-btn icon-btn-danger" type="submit" title="Excluir ação" style={{ width: 30, height: 30 }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                    </button>
                  </form>
                </div>

                {/* meta: solicitante, prazo, reunião */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.9rem", margin: "0.5rem 0", fontSize: "0.82rem" }} className="muted">
                  {a.requesterName && <span>Solicitante: <strong>{a.requesterName}</strong></span>}
                  {a.dueDate && <span style={{ color: isOverdue(a.dueDate) ? "#dc2626" : undefined }}>Prazo: {formatDate(a.dueDate)}</span>}
                  {a.seriesName && <span>Reunião: {a.seriesName}{a.occurredOn ? ` (${formatDate(a.occurredOn)})` : ""}</span>}
                  {a.ccNames.length > 0 && <span>Em cópia: {a.ccNames.join(", ")}</span>}
                </div>

                {/* demandas */}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.4rem" }}>
                  {a.demandas.map((d) => (
                    <div key={d.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", background: "var(--surface-2)", borderRadius: 8, padding: "0.5rem 0.7rem", flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 280px" }}>
                        <div style={{ fontWeight: 500, fontSize: "0.88rem" }}>{d.description}</div>
                        <div className="soft" style={{ fontSize: "0.78rem" }}>
                          {d.assigneeNames.length > 0 ? d.assigneeNames.join(", ") : "Sem responsável"}
                        </div>
                        {d.attachments.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.4rem" }}>
                            {d.attachments.map((at) => <AttachmentLink key={at.id} path={at.path} filename={at.filename} />)}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <Badge tone={ACTION_STATUS_TONE[d.status as Enums<"action_status">]}>{ACTION_STATUS[d.status as Enums<"action_status">]}</Badge>
                        <InlineStatus id={d.id} value={d.status} options={options(ACTION_STATUS)} action={setDemandaStatus} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* anexos */}
                {a.attachments.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.6rem" }}>
                    {a.attachments.map((at) => <AttachmentLink key={at.id} path={at.path} filename={at.filename} />)}
                  </div>
                )}
              </div>
            ))}
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
      />
    </div>
  );
}
