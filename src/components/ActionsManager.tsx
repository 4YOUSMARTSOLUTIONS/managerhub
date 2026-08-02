"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PRIORITY, PRIORITY_TONE, EFF_STATUS_LABEL, effStatus, type EffStatus } from "@/lib/constants";
import { EffStatusBadge } from "@/components/ui/EffStatusBadge";
import { formatDate, isOverdue, shortName } from "@/lib/format";
import { deleteAction } from "@/lib/actions/actions";
import { ConfirmActionButton } from "@/components/ui/ConfirmActionButton";
import { ActionDialog, type Opt, type SecaoOpt, type BlocoOpt, type ItemOpt, type OccOpt } from "./ActionDialog";
import { ImportActionsDialog } from "./ImportActionsDialog";
import { ExportButton } from "@/components/ui/ExportButton";
import { DemandaPanel, type DemandaInfo, type AssigneeState } from "./DemandaPanel";
import type { Person } from "./PeoplePicker";
import type { Enums } from "@/types/database";

export type DemandaCard = {
  id: string;
  description: string;
  status: string;
  dueDate: string | null;
  assigneeNames: string[];
  assigneeIds: string[];
  assigneeStates: AssigneeState[];
  pendingCount: number;
  attachments: { id: string; filename: string; path: string }[];
};

/** Filtros aplicados no banco (vêm da URL). */
export type ActionFilters = {
  q: string; priority: string; sdpo: string; status: string;
  programa: string; pilar: string; requester: string; assignee: string; from: string; to: string;
};

/** Opções dos selects, extraídas da base inteira (não só da página). */
export type FilterOptions = { programas: string[]; pilares: string[]; requesters: string[]; assignees: string[] };

/** chave do filtro -> nome do parâmetro na URL */
const PARAM: Record<keyof ActionFilters, string> = {
  q: "q", priority: "prio", sdpo: "sdpo", status: "st",
  programa: "prog", pilar: "pilar", requester: "sol", assignee: "resp", from: "de", to: "ate",
};

export type ActionRow = {
  id: string;
  code: number;
  isSdpo: boolean;
  programaName: string | null;
  pilarName: string | null;
  secaoName: string | null;
  blocoName: string | null;
  itemName: string | null;
  seriesName: string | null;
  occurredOn: string | null;
  kpiName: string | null;
  toolName: string | null;
  unitName: string | null;
  requesterId: string | null;
  requesterName: string | null;
  createdAt: string;
  priority: Enums<"priority_level">;
  dueDate: string | null;
  demandas: DemandaCard[];
  ccNames: string[];
  attachments: { id: string; filename: string; path: string }[];
};

export function ActionsManager({
  actions, currentUserId, isAdmin, isOwner, people, pilares, secoes, blocos, itens, kpis, tools, series, occurrences, units, aiEnabled,
  filters, filterOptions, total,
}: {
  actions: ActionRow[];
  filters: ActionFilters;
  filterOptions: FilterOptions;
  total: number;
  currentUserId: string;
  isAdmin: boolean;
  isOwner: boolean;
  people: Person[];
  pilares: Opt[];
  secoes: SecaoOpt[];
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
        label: a.demandas.length > 1 ? `#${a.code}.${di + 1}` : `#${a.code}`,
        description: d.description,
        status: d.status as Enums<"action_status">,
        dueDate: d.dueDate,
        priority: a.priority,
        assigneeIds: d.assigneeIds,
        assigneeNames: d.assigneeNames,
        assigneeStates: d.assigneeStates,
        attachments: d.attachments,
        requesterName: a.requesterName,
        ccNames: a.ccNames,
        isSdpo: a.isSdpo,
        pilarName: a.pilarName,
        secaoName: a.secaoName,
        blocoName: a.blocoName,
        itemName: a.itemName,
        kpiName: a.kpiName,
        toolName: a.toolName,
        seriesName: a.seriesName,
        occurredOn: a.occurredOn,
      },
      requesterId: a.requesterId,
    });

  // ---------- Filtros (aplicados no banco, sincronizados pela URL) ----------
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(() => Object.values(filters).some(Boolean));
  const [qDraft, setQDraft] = useState(filters.q);

  const activeCount = Object.values(filters).filter(Boolean).length;
  const hasFilters = activeCount > 0;

  const applyFilters = useCallback((patch: Partial<ActionFilters>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      const param = PARAM[key as keyof ActionFilters];
      if (value) next.set(param, value); else next.delete(param);
    }
    next.delete("p"); // qualquer mudança de filtro volta para a primeira página
    const qs = next.toString();
    startTransition(() => router.push(qs ? `/acoes?${qs}` : "/acoes", { scroll: false }));
  }, [router, searchParams]);

  const clearFilters = () => {
    setQDraft("");
    startTransition(() => router.push("/acoes", { scroll: false }));
  };

  // busca livre: espera o usuário parar de digitar antes de consultar o banco
  useEffect(() => {
    if (qDraft === filters.q) return;
    const t = setTimeout(() => applyFilters({ q: qDraft }), 400);
    return () => clearTimeout(t);
  }, [qDraft, filters.q, applyFilters]);
  useEffect(() => { setQDraft(filters.q); }, [filters.q]);

  const { programas: programaOpts, pilares: pilarOpts, requesters: requesterOpts, assignees: assigneeOpts } = filterOptions;

  // O banco já devolveu só as ações que casam. Aqui resta recortar as DEMANDAS
  // exibidas dentro de cada ação, para refletir os filtros de status/responsável/busca.
  const term = norm(filters.q.trim());
  const filtered = useMemo(() => {
    return actions
      .map((a) => {
        const items = a.demandas.map((d, di) => {
          const finalizada = d.status === "done" || d.status === "cancelled";
          const overdue = !!d.dueDate && !finalizada && isOverdue(d.dueDate);
          const eff = effStatus(d.status as Enums<"action_status">, overdue, d.pendingCount > 0);
          return { d, di, eff };
        });
        return { a, items };
      })
      .map(({ a, items }) => {
        let its = items;
        if (filters.status) its = its.filter((x) => x.eff === filters.status);
        if (filters.assignee) its = its.filter((x) => x.d.assigneeNames.includes(filters.assignee));
        return { a, items: its };
      })
      .filter(({ items }) => items.length > 0)
      // busca livre: se a ação casa, mantém todas as demandas; senão, só as que casam
      .map(({ a, items }) => {
        if (!term) return { a, items };
        const actionHay = norm(
          [`#${a.code}`, a.pilarName, a.secaoName, a.blocoName, a.itemName, a.requesterName, a.kpiName, a.toolName]
            .filter(Boolean).join(" "),
        );
        if (actionHay.includes(term)) return { a, items };
        const its = items.filter((x) => norm([x.d.description, ...x.d.assigneeNames].join(" ")).includes(term));
        return { a, items: its };
      })
      .filter(({ items }) => items.length > 0);
  }, [actions, term, filters.status, filters.assignee]);

  return (
    <div>
      <PageHeader
        title="Ações"
        subtitle="Abertura e acompanhamento de ações."
        action={
          <div style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
            {isOwner && <ImportActionsDialog />}
            {isOwner && (
              <ExportButton
                filename="acoes.xlsx"
                sheetName="Ações"
                headers={["Ação", "Responsáveis", "Solicitante", "Criada por", "Data de criação", "Reunião", "Prazo", "Data de conclusão", "Status", "Prioridade", "Unidade", "KPI", "Ferramenta", "SDPO", "Programa", "Pilar", "Seção", "Bloco", "Item", "Comentários"]}
                rows={actions.flatMap((a) => a.demandas.map((d) => {
                  const br = (s: string | null) => (s && s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : (s ?? ""));
                  const st: Record<string, string> = { open: "Aberta", in_progress: "Em andamento", blocked: "Bloqueada", done: "Concluída", cancelled: "Cancelada" };
                  return [d.description, d.assigneeNames.join("; "), a.requesterName ?? "", "", br(a.createdAt), a.seriesName ?? "", br(d.dueDate), "", st[d.status] ?? d.status, PRIORITY[a.priority], a.unitName ?? "", a.kpiName ?? "", a.toolName ?? "", a.isSdpo ? "Sim" : "Não", a.programaName ?? "", a.pilarName ?? "", a.secaoName ?? "", a.blocoName ?? "", a.itemName ?? "", ""];
                }))}
              />
            )}
            <button className="btn btn-primary" onClick={() => setOpen(true)}>+ Nova ação</button>
          </div>
        }
      />

      <Section
        title={`${total} ${total === 1 ? "ação" : "ações"}${hasFilters ? " no filtro" : ""}${isPending ? " · atualizando…" : ""}`}
        padded={false}
        action={
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
            {hasFilters && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>Limpar filtros</button>
            )}
            <button
              type="button"
              className={`btn btn-sm ${filtersOpen || hasFilters ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setFiltersOpen((v) => !v)}
              style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
            >
              <Filter size={15} />
              Filtros
              {activeCount > 0 && <Badge tone="blue">{activeCount}</Badge>}
            </button>
          </div>
        }
      >
        {filtersOpen && (
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--mh-border)", background: "var(--mh-surface-2)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.85rem" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <span className="label" style={{ margin: 0 }}>Buscar</span>
                <input className="input" value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="#ID, descrição, responsável…" style={{ width: "100%" }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <span className="label" style={{ margin: 0 }}>Prioridade</span>
                <select className="select" value={filters.priority} onChange={(e) => applyFilters({ priority: e.target.value })}>
                  <option value="">Todas</option>
                  {Object.entries(PRIORITY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <span className="label" style={{ margin: 0 }}>SDPO</span>
                <select className="select" value={filters.sdpo} onChange={(e) => applyFilters({ sdpo: e.target.value })}>
                  <option value="">Todos</option>
                  <option value="sim">Sim</option>
                  <option value="nao">Não</option>
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <span className="label" style={{ margin: 0 }}>Status</span>
                <select className="select" value={filters.status} onChange={(e) => applyFilters({ status: e.target.value })}>
                  <option value="">Todos</option>
                  {(Object.keys(EFF_STATUS_LABEL) as EffStatus[]).map((k) => <option key={k} value={k}>{EFF_STATUS_LABEL[k]}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <span className="label" style={{ margin: 0 }}>Programa</span>
                <select className="select" value={filters.programa} onChange={(e) => applyFilters({ programa: e.target.value })}>
                  <option value="">Todos</option>
                  {programaOpts.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <span className="label" style={{ margin: 0 }}>Pilar</span>
                <select className="select" value={filters.pilar} onChange={(e) => applyFilters({ pilar: e.target.value })}>
                  <option value="">Todos</option>
                  {pilarOpts.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <span className="label" style={{ margin: 0 }}>Solicitante</span>
                <select className="select" value={filters.requester} onChange={(e) => applyFilters({ requester: e.target.value })}>
                  <option value="">Todos</option>
                  {requesterOpts.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <span className="label" style={{ margin: 0 }}>Responsável</span>
                <select className="select" value={filters.assignee} onChange={(e) => applyFilters({ assignee: e.target.value })}>
                  <option value="">Todos</option>
                  {assigneeOpts.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <span className="label" style={{ margin: 0 }}>Aberta de</span>
                <input type="date" className="input" value={filters.from} onChange={(e) => applyFilters({ from: e.target.value })} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <span className="label" style={{ margin: 0 }}>Aberta até</span>
                <input type="date" className="input" value={filters.to} onChange={(e) => applyFilters({ to: e.target.value })} />
              </label>
            </div>
          </div>
        )}
        {filtered.length === 0 ? (
          hasFilters
            ? <EmptyState title="Nenhuma ação encontrada" description="Ajuste ou limpe os filtros para ver as ações." />
            : <EmptyState title="Nenhuma ação" description="Crie ações para acompanhar pendências e o Programa de Excelência." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Ação</th>
                  <th>Prioridade</th>
                  <th>SDPO</th>
                  <th>Programa</th>
                  <th>Pilar</th>
                  <th>Seção</th>
                  <th>Descrição</th>
                  <th>Responsáveis</th>
                  <th>Solicitante</th>
                  <th>Aberta em</th>
                  <th>Status</th>
                  <th>Prazo</th>
                  <th style={{ textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.flatMap(({ a, items }, ri) =>
                  items.map(({ d, di, eff }, idx) => {
                    const first = idx === 0;
                    const finalizada = d.status === "done" || d.status === "cancelled";
                    const overdue = !!d.dueDate && !finalizada && isOverdue(d.dueDate);
                    return (
                      <tr key={d.id} style={{ borderTop: first && ri > 0 ? "2px solid var(--border-strong)" : undefined, opacity: d.status === "cancelled" ? 0.55 : 1 }}>
                        <td style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>#{a.code}{a.demandas.length > 1 ? `.${di + 1}` : ""}</td>
                        <td>{first && <Badge tone={PRIORITY_TONE[a.priority]}>{PRIORITY[a.priority]}</Badge>}</td>
                        <td>{first && (a.isSdpo ? <Badge tone="purple">Sim</Badge> : <span className="soft">Não</span>)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{first && (a.programaName ? <Badge tone="blue">{a.programaName}</Badge> : <span className="soft">—</span>)}</td>
                        <td className="muted" style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.pilarName ?? ""}>{first ? (a.pilarName ?? "—") : ""}</td>
                        <td className="muted" style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.secaoName ?? ""}>{first ? (a.secaoName ?? "—") : ""}</td>
                        <td style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "help" }} title={d.description}>{d.description}</td>
                        <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.assigneeNames.map(shortName).join(", ")}>
                          {d.assigneeNames.length > 0 ? (
                            <>
                              {shortName(d.assigneeNames[0])}
                              {d.assigneeNames.length > 1 && <span className="soft" style={{ marginLeft: 4 }}>+{d.assigneeNames.length - 1}</span>}
                            </>
                          ) : <span className="soft">—</span>}
                          {d.assigneeStates.length > 1 && (
                            <span className="soft" style={{ marginLeft: 6 }} title="Responsáveis que já concluíram a parte">
                              · {d.assigneeStates.filter((s) => s.completedAt).length}/{d.assigneeStates.length} ✓
                            </span>
                          )}
                          {d.attachments.length > 0 && <span className="soft" style={{ marginLeft: 6 }} title={`${d.attachments.length} anexo(s)`}>📎{d.attachments.length}</span>}
                        </td>
                        <td className="muted" style={{ maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.requesterName ?? ""}>
                          {first ? (a.requesterName ? shortName(a.requesterName) : "—") : ""}
                        </td>
                        <td className="muted" style={{ whiteSpace: "nowrap" }}>{first ? formatDate(a.createdAt) : ""}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <EffStatusBadge eff={eff} overdue={overdue} />
                        </td>
                        <td style={{ whiteSpace: "nowrap", color: overdue ? "var(--mh-danger)" : "var(--text-muted)" }}>{d.dueDate ? formatDate(d.dueDate) : "—"}</td>
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
        secoes={secoes}
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
