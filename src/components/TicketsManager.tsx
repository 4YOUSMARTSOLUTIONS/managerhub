"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Section } from "@/components/ui/Section";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewTicketDialog, type SlaOpt } from "@/components/NewTicketDialog";
import { ImportarChamadosDialog } from "@/components/ImportarChamadosDialog";
import { BotoesFiltroChamados, PainelFiltrosChamados, useFiltrosChamados } from "@/components/FiltrosChamados";
import { contarFiltros, filtrarChamados, ordenarPorPrazo } from "@/lib/chamados-filtros";
import { TicketPanel } from "@/components/TicketPanel";
import { NpsRating } from "@/components/NpsRating";
import { deleteTicket, decideTicketConclusion, getDescricoesDeChamados } from "@/lib/actions/tickets";
import { confirmDialog } from "@/components/ui/confirm";
import { MenuDeLinha } from "@/components/ui/MenuDeLinha";
import { aoClicarNaLinha } from "@/lib/linha-clicavel";
import { PRIORITY, PRIORITY_TONE, ticketStatusView } from "@/lib/constants";
import { formatDateTime, isOverdue, numeroChamado, shortName } from "@/lib/format";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { ABRIR_CHAMADO } from "@/lib/notificacao-destino";
import { tirarDaUrl } from "@/lib/abrir-pela-url";

const TERMINAL = ["resolved", "closed", "cancelled"];
const POR_PAGINA = 50;
import type { Enums } from "@/types/database";

/** "23/11/2026": a hora completa fica na dica */
const soData = (v: string | null) => formatDateTime(v).split(",")[0];
/** "23/11/26 14:35": o prazo mantém a hora, porque o SLA conta em horas */
const dataHoraCurta = (v: string | null) => formatDateTime(v).replace(/\/\d{2}(\d{2}), /, "/$1 ");
const CORTE: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

export type Opt = { id: string; name: string; active?: boolean };
export type CatOpt = { id: string; name: string; sectorId: string; active?: boolean };
export type Member = { id: string; name: string };
export type TicketRow = {
  id: string;
  code: string | null;
  title: string;
  /** veio do sistema anterior: já foi encerrado lá e não entra na avaliação */
  importado: boolean;
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
  approvalRequestedAt: string | null;
  npsScore: number | null;
  npsComment: string | null;
  attachments: { id: string; path: string; filename: string; contentType: string | null }[];
};

/**
 * As abas de Chamados. O aviso do sino leva a `?chamado=<id>`: a aba
 * Chamados vem à frente, mesmo com a pessoa no Dashboard, e a ficha abre lá.
 */
export function AbasDosChamados({ tabs }: { tabs: Tab[] }) {
  const pedido = useSearchParams().get(ABRIR_CHAMADO);
  const [ativa, setAtiva] = useState(pedido ? "chamados" : tabs[0]?.id);
  // muda de aba uma vez por pedido novo; depois a pessoa troca à vontade
  const [pedidoVisto, setPedidoVisto] = useState(pedido);
  if (pedido !== pedidoVisto) {
    setPedidoVisto(pedido);
    if (pedido) setAtiva("chamados");
  }
  return <Tabs tabs={tabs} active={ativa} onActiveChange={setAtiva} />;
}

export function TicketsManager({
  tickets, sectors, categories, units, slas, slaMode, members, currentUserId, isAdmin, fullAccess, isOwner, managedSectorIds,
  abrir = null,
}: {
  tickets: TicketRow[];
  sectors: Opt[];
  categories: CatOpt[];
  units: Opt[];
  slas: SlaOpt[];
  slaMode: "priority" | "category";
  members: Member[];
  currentUserId: string;
  isAdmin: boolean;
  fullAccess: boolean;
  isOwner: boolean;
  managedSectorIds: string[];
  /** o chamado pedido pela URL (aviso do sino), já conferido no escopo de quem vê; null se não achou */
  abrir?: TicketRow | null;
}) {
  const showPriority = slaMode !== "category";
  const managedSet = new Set(managedSectorIds);
  // pode tratar um chamado específico: acesso total (owner/admin) ou gestor do setor dele
  const canEditTicket = (t: TicketRow) => fullAccess || (!!t.sectorId && managedSet.has(t.sectorId));
  const [newOpen, setNewOpen] = useState(false);
  // `?chamado=<id>` (aviso do sino) abre a ficha. Clicar em outro aviso com a
  // tela já aberta troca o chamado: o pedido muda e o painel acompanha.
  const pedido = useSearchParams().get(ABRIR_CHAMADO);
  const doPedido = pedido && abrir?.id === pedido ? abrir : null;
  const [selected, setSelected] = useState<TicketRow | null>(doPedido);
  const [pedidoVisto, setPedidoVisto] = useState(pedido);
  if (pedido !== pedidoVisto) {
    setPedidoVisto(pedido);
    if (doPedido) setSelected(doPedido);
  }
  // excluído, ou fora do que a pessoa alcança: avisa em vez de abrir a lista calada
  useEffect(() => {
    if (!pedido || abrir?.id === pedido) return;
    toast.info("Este chamado não está mais disponível para você.");
    tirarDaUrl(ABRIR_CHAMADO);
  }, [pedido, abrir]);
  const fecharFicha = () => {
    setSelected(null);
    tirarDaUrl(ABRIR_CHAMADO);
  };
  const [ratingTicket, setRatingTicket] = useState<TicketRow | null>(null);
  const [decideTicket, setDecideTicket] = useState<TicketRow | null>(null);
  const [reopenNote, setReopenNote] = useState("");
  const [decideError, setDecideError] = useState("");
  const [deciding, startDecide] = useTransition();
  const { filtros, pagina, setPagina } = useFiltrosChamados();
  const filtrados = useMemo(() => ordenarPorPrazo(filtrarChamados(tickets, filtros)), [tickets, filtros]);
  const comFiltro = contarFiltros(filtros) > 0;
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const daPagina = filtrados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);
  const tituloLista = comFiltro
    ? `${filtrados.length.toLocaleString("pt-BR")} de ${tickets.length.toLocaleString("pt-BR")} chamados`
    : `${tickets.length.toLocaleString("pt-BR")} ${tickets.length === 1 ? "chamado" : "chamados"}`;

  // a descrição não vem na carga da tela (são milhares): busca só a da página aberta
  const [descricoes, setDescricoes] = useState<Record<string, string>>({});
  const buscadas = useRef(new Set<string>());
  const idsDaPagina = daPagina.map((t) => t.id).join(",");
  useEffect(() => { buscadas.current.clear(); }, [tickets]);
  useEffect(() => {
    const faltam = idsDaPagina ? idsDaPagina.split(",").filter((id) => !buscadas.current.has(id)) : [];
    if (faltam.length === 0) return;
    faltam.forEach((id) => buscadas.current.add(id));
    getDescricoesDeChamados(faltam)
      .then((d) => setDescricoes((prev) => ({ ...prev, ...d })))
      .catch(() => faltam.forEach((id) => buscadas.current.delete(id)));
  }, [idsDaPagina, tickets]);
  const dicaDoChamado = (t: TicketRow) => {
    const d = descricoes[t.id]?.trim();
    return d && d !== t.title.trim() ? `${t.title}\n\n${d}` : t.title;
  };

  const router = useRouter();
  const excluirChamado = async (t: TicketRow) => {
    const ok = await confirmDialog({
      title: "Excluir chamado",
      message: <>Excluir o chamado <strong>{t.title}</strong>?</>,
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.append("id", t.id);
    try {
      const r = await deleteTicket(fd);
      if (r?.error) { toast.error(r.error); return; }
      router.refresh();
    } catch {
      toast.error("Não foi possível excluir o chamado. Tente de novo.");
    }
  };

  const runDecide = (approve: boolean) => {
    if (!decideTicket) return;
    const note = reopenNote.trim();
    if (!approve && !note) { setDecideError("Explique o motivo ao reabrir (recusar a conclusão)."); return; }
    setDecideError("");
    startDecide(async () => {
      const res = await decideTicketConclusion(decideTicket.id, approve, note);
      if (res.error) { setDecideError(res.error); return; }
      setDecideTicket(null);
      setReopenNote("");
    });
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginBottom: "0.9rem" }}>
        {isOwner && <ImportarChamadosDialog />}
        <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>+ Abrir chamado</button>
      </div>

      {/* a rolagem lateral fica só na tabela: no corpo do cartão ela cortava a
          caixa dos filtros quando a lista tinha poucas linhas */}
      <Section title={tituloLista} titleExtra={<BotoesFiltroChamados />} padded={false} bodyStyle={{ overflowX: "visible" }}>
        <PainelFiltrosChamados tickets={tickets} comPrioridade={showPriority} />
        {filtrados.length > 0 ? (
          /* largura fixa por coluna: nada quebra linha, o texto longo vira reticências
             com o dado inteiro na dica, e o Chamado fica com o espaço que sobra */
          <div style={{ overflowX: "auto" }}>
          <table className="table table-justa" style={{ tableLayout: "fixed", minWidth: 1030 }}>
            <colgroup>
              <col style={{ width: 52 }} />
              <col style={{ width: 48 }} />
              <col />
              <col style={{ width: 83 }} />
              <col style={{ width: "6%" }} />
              {showPriority && <col style={{ width: 62 }} />}
              {/* cabem os nomes reduzidos inteiros: o solicitante chega a 17 letras */}
              <col style={{ width: 122 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 68 }} />
              <col style={{ width: 86 }} />
              <col style={{ width: 126 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 68 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Código</th>
                <th>Unidade</th>
                <th>Chamado</th>
                <th>Setor</th>
                <th>Categoria</th>
                {showPriority && <th>Prioridade</th>}
                <th>Solicitante</th>
                <th>Responsável</th>
                <th>Aberto em</th>
                <th>Prazo</th>
                <th>Status</th>
                <th title="Data de conclusão ou da última atualização">Atualização</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {daPagina.map((t) => {
                const terminal = TERMINAL.includes(t.status);
                const openish = !terminal;
                const lastDate = terminal ? (t.resolvedAt ?? t.updatedAt) : t.updatedAt;
                const awaitingApproval = !!t.approvalRequestedAt;
                const sv = ticketStatusView(t.status, openish && isOverdue(t.dueDate), awaitingApproval);
                // solicitante pode avaliar quando o chamado está resolvido/fechado
                const canRate = !t.importado && t.requesterId === currentUserId && (t.status === "resolved" || t.status === "closed");
                // solicitante decide a conclusão (de acordo / reabrir) quando aguardando aprovação
                const canDecide = t.requesterId === currentUserId && awaitingApproval;
                return (
                  <tr key={t.id} onClick={(e) => aoClicarNaLinha(e, () => setSelected(t))} style={{ cursor: "pointer" }}>
                    <td style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", fontWeight: 600 }}>
                      <button type="button" className="cell-link cell-link-id" onClick={() => setSelected(t)} title="Abrir o chamado">
                        {numeroChamado(t.code)}
                      </button>
                    </td>
                    <td className="muted" style={{ ...CORTE, fontSize: "0.75rem" }} title={t.unitName ?? ""}>{t.unitName ?? "—"}</td>
                    <td style={{ fontWeight: 600, overflow: "hidden" }} title={dicaDoChamado(t)}>
                      <span style={{ display: "flex", alignItems: "center", gap: "0.35rem", minWidth: 0 }}>
                        <button type="button" className="cell-trunc" onClick={() => setSelected(t)} style={{ minWidth: 0, background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 600, color: "var(--text)", cursor: "pointer", textAlign: "left" }}>
                          {t.title}
                        </button>
                        {t.attachments.length > 0 && <span className="soft" style={{ fontSize: "0.75rem", flexShrink: 0 }}>📎{t.attachments.length}</span>}
                      </span>
                    </td>
                    <td className="muted" style={{ ...CORTE, fontSize: "0.75rem" }} title={t.sectorName ?? ""}>{t.sectorName ?? "—"}</td>
                    <td className="muted" style={{ ...CORTE, fontSize: "0.75rem" }} title={t.categoryName ?? ""}>{t.categoryName ?? "—"}</td>
                    {showPriority && <td style={{ whiteSpace: "nowrap" }}><Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY[t.priority]}</Badge></td>}
                    <td className="muted" style={{ ...CORTE, fontSize: "0.75rem" }} title={t.requesterName ?? ""}>{t.requesterName ? shortName(t.requesterName) : "—"}</td>
                    <td className="muted" style={{ ...CORTE, fontSize: "0.75rem" }} title={t.assigneeName ?? ""}>{t.assigneeName ? shortName(t.assigneeName) : "—"}</td>
                    <td className="muted" style={{ whiteSpace: "nowrap", fontSize: "0.75rem" }} title={formatDateTime(t.createdAt)}>{soData(t.createdAt)}</td>
                    <td style={{ color: openish && isOverdue(t.dueDate) ? "var(--mh-danger)" : "var(--text-muted)", whiteSpace: "nowrap", fontSize: "0.75rem" }} title={formatDateTime(t.dueDate)}>{dataHoraCurta(t.dueDate)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Badge tone={sv.tone}>{sv.label}</Badge>
                    </td>
                    <td className="muted" style={{ whiteSpace: "nowrap", fontSize: "0.75rem" }} title={`${terminal ? "Concluído em" : "Atualizado em"} ${formatDateTime(lastDate)}`}>
                      {terminal && <span style={{ color: "var(--mh-success)", marginRight: 3 }}>✓</span>}
                      {soData(lastDate)}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ display: "inline-flex", gap: "0.3rem", alignItems: "center", justifyContent: "flex-end" }}>
                        {/* o que depende do solicitante fica à vista, para não passar despercebido */}
                        {canDecide && (
                          <button
                            type="button"
                            className="icon-btn"
                            title="Dar o de acordo / reabrir"
                            onClick={() => { setDecideTicket(t); setReopenNote(""); setDecideError(""); }}
                            style={{ color: "var(--mh-success)" }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                          </button>
                        )}
                        {canRate && (
                          <button
                            type="button"
                            className="icon-btn"
                            title={t.npsScore != null ? `Avaliação: ${t.npsScore}/10, clique para editar` : "Avaliar chamado"}
                            onClick={() => setRatingTicket(t)}
                            style={{ color: "var(--mh-warning)" }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill={t.npsScore != null ? "var(--mh-warning)" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                          </button>
                        )}
                        <MenuDeLinha
                          rotulo={`Opções do chamado ${numeroChamado(t.code)}`}
                          itens={[
                            canEditTicket(t)
                              ? { rotulo: "Tratar", icone: <Wrench size={14} />, onClick: () => setSelected(t) }
                              : { rotulo: "Abrir", icone: <Eye size={14} />, onClick: () => setSelected(t) },
                            ...(isAdmin
                              ? [{ rotulo: "Excluir", icone: <Trash2 size={14} />, perigo: true, onClick: () => void excluirChamado(t) }]
                              : []),
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        ) : (
          tickets.length > 0
            ? <EmptyState title="Nenhum chamado encontrado" description="Ajuste ou limpe os filtros para ver os chamados." />
            : <EmptyState title="Nenhum chamado" description="Abra o primeiro chamado para começar." />
        )}
        {totalPaginas > 1 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.6rem", padding: "0.7rem 1.25rem", borderTop: "1px solid var(--mh-border)" }}>
            <span className="muted" style={{ fontSize: "0.78rem" }}>Página {paginaAtual} de {totalPaginas}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={paginaAtual <= 1} onClick={() => setPagina(paginaAtual - 1)}>Anterior</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={paginaAtual >= totalPaginas} onClick={() => setPagina(paginaAtual + 1)}>Próxima</button>
          </div>
        )}
      </Section>

      <NewTicketDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        sectors={sectors}
        categories={categories}
        units={units}
        slas={slas}
        slaMode={slaMode}
      />
      <TicketPanel
        open={!!selected}
        onClose={fecharFicha}
        ticket={selected}
        sectors={sectors}
        categories={categories}
        members={members}
        slaMode={slaMode}
        canEdit={!!selected && canEditTicket(selected)}
        canComment={!!selected && (canEditTicket(selected) || selected.requesterId === currentUserId)}
        canRate={false}
        canApprove={!!selected && selected.requesterId === currentUserId && !!selected.approvalRequestedAt}
      />

      {decideTicket && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 1rem", zIndex: 70, overflowY: "auto" }}>
          <div className="card" style={{ width: "100%", maxWidth: 460, boxShadow: "var(--mh-shadow-e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>Conclusão do chamado {numeroChamado(decideTicket.code)}</h2>
              <button type="button" onClick={() => setDecideTicket(null)} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
            </div>
            <div style={{ padding: "1.1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
              <div className="muted" style={{ fontSize: "0.75rem" }}>{decideTicket.title}</div>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--mh-warning)", background: "var(--mh-warning-soft)", padding: "0.6rem 0.7rem", borderRadius: 8 }}>
                O atendimento foi concluído e aguarda o seu <strong>de acordo</strong>. Se resolveu, aprove; caso contrário, reabra explicando o motivo.
              </p>
              <div>
                <label className="label">Motivo <span className="soft">(obrigatório só ao reabrir)</span></label>
                <textarea className="textarea" value={reopenNote} onChange={(e) => setReopenNote(e.target.value)} placeholder="Ex.: o problema voltou a ocorrer…" style={{ minHeight: 60 }} />
              </div>
              {decideError && <p style={{ color: "var(--mh-danger)", fontSize: "0.75rem", margin: 0 }}>{decideError}</p>}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
              <button type="button" className="btn btn-ghost" disabled={deciding} onClick={() => runDecide(false)} title="Recusar a conclusão e reabrir o chamado">↩ Reabrir</button>
              <button type="button" className="btn" style={{ background: "var(--mh-success)", color: "#fff" }} disabled={deciding} onClick={() => runDecide(true)} title="Concordar com a conclusão e encerrar">{deciding ? "…" : "✓ Aprovar conclusão"}</button>
            </div>
          </div>
        </div>
      )}

      {ratingTicket && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 1rem", zIndex: 70, overflowY: "auto" }}>
          <div className="card" style={{ width: "100%", maxWidth: 460, boxShadow: "var(--mh-shadow-e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>Avaliar chamado {numeroChamado(ratingTicket.code)}</h2>
              <button type="button" onClick={() => setRatingTicket(null)} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
            </div>
            <div style={{ padding: "1.1rem 1.25rem" }}>
              <div className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.6rem" }}>{ratingTicket.title}</div>
              <NpsRating ticketId={ratingTicket.id} current={ratingTicket.npsScore} currentComment={ratingTicket.npsComment} onSubmitted={() => setRatingTicket(null)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
