"use client";

import { AlertTriangle } from "lucide-react";
import { DetailModal } from "@/components/ui/DetailModal";
import { FeriasTimeline, type TimelineLinha, type TipoNaTimeline } from "@/components/FeriasTimeline";
import type { AgendaItem } from "@/lib/ferias-agenda";
import { formatDate, shortName } from "@/lib/format";

/*
 * Coincidência de férias na aprovação (LUIZ, 12/11/2026): quem decide um
 * pedido precisa ver se mais alguém da equipe estará fora no mesmo período.
 * A fila mostra o alerta em amarelo; o ícone de calendário abre a linha do
 * tempo da equipe em volta do pedido.
 *
 * "Equipe" é o recorte que a tela já usa: a cadeia de quem é só gestor (a RLS
 * já entrega só ela) ou o "Minha equipe" do topo. Em "Toda a empresa" seria a
 * empresa inteira, então ali vale o setor do colaborador.
 */

/** o que a fila precisa do pedido */
export type PedidoParaCoincidencia = {
  id: string;
  userId: string;
  fullName: string | null;
  departmentName: string | null;
  startDate: string;
  endDate: string;
  dias: number;
};

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** do 1º dia do mês anterior ao início até o último dia do mês seguinte ao término */
export function janelaDoPedido(inicio: string, fim: string): { de: string; ate: string } {
  const a = new Date(`${inicio}T12:00:00`);
  const b = new Date(`${fim}T12:00:00`);
  return {
    de: iso(new Date(a.getFullYear(), a.getMonth() - 1, 1, 12)),
    ate: iso(new Date(b.getFullYear(), b.getMonth() + 2, 0, 12)),
  };
}

const cruza = (i: { inicio: string; fim: string }, de: string, ate: string) => i.inicio <= ate && i.fim >= de;

/**
 * As férias dos outros que contam para o pedido: fora o próprio colaborador e,
 * em `porSetor`, só quem é do setor dele (pelo id quando a agenda traz o
 * pedido; senão pelo nome do setor da linha).
 */
function daEquipe(itens: AgendaItem[], p: PedidoParaCoincidencia, porSetor: boolean): AgendaItem[] {
  if (!porSetor) return itens;
  const setorId = itens.find((i) => i.userId === p.userId)?.setorId ?? null;
  return itens.filter((i) =>
    i.userId === p.userId || (setorId ? i.setorId === setorId : Boolean(p.departmentName) && i.setor === p.departmentName));
}

/** quem mais estará de férias (efetivada, aprovada ou pedida) dentro do período pedido */
export function coincidenciasDoPedido(
  itens: AgendaItem[], p: PedidoParaCoincidencia, porSetor: boolean,
): { userId: string; nome: string | null; periodos: AgendaItem[] }[] {
  const porPessoa = new Map<string, { userId: string; nome: string | null; periodos: AgendaItem[] }>();
  for (const i of daEquipe(itens, p, porSetor)) {
    if (i.userId === p.userId || !cruza(i, p.startDate, p.endDate)) continue;
    const atual = porPessoa.get(i.userId) ?? { userId: i.userId, nome: i.nome, periodos: [] };
    atual.periodos.push(i);
    porPessoa.set(i.userId, atual);
  }
  return [...porPessoa.values()].sort((a, b) => a.periodos[0].inicio.localeCompare(b.periodos[0].inicio));
}

const ROTULO_STATUS: Record<AgendaItem["status"], string> = {
  efetivada: "efetivada",
  aprovada: "aprovada pelo gestor",
  solicitada: "aguardando aprovação",
};

/** "EDUARDO BRITO (10/01 a 20/01, efetivada)": para o alerta e a confirmação */
export function descreverCoincidencia(c: { nome: string | null; periodos: AgendaItem[] }): string {
  const periodos = c.periodos
    .map((i) => `${formatDate(i.inicio)} a ${formatDate(i.fim)}, ${ROTULO_STATUS[i.status]}`)
    .join("; ");
  return `${shortName(c.nome)} (${periodos})`;
}

/** o alerta amarelo: quantas pessoas coincidem */
export function AlertaCoincidencia({ qtd, porSetor, compacto = false }: { qtd: number; porSetor: boolean; compacto?: boolean }) {
  if (qtd === 0) return null;
  const quem = porSetor ? "do setor" : "da equipe";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "0.3rem", color: "var(--mh-warning)",
      fontSize: compacto ? "0.75rem" : "0.82rem", fontWeight: 600, whiteSpace: "nowrap",
    }}>
      <AlertTriangle size={compacto ? 12 : 14} aria-hidden />
      Coincide com {qtd} {qtd === 1 ? "pessoa" : "pessoas"} {quem}
    </span>
  );
}

/** a linha do tempo da equipe em volta de um pedido, com o alerta e quem coincide */
export function LinhaDoTempoDoPedido({
  pedido, itens, carregando, erro, porSetor, hoje, onClose, footer,
}: {
  pedido: PedidoParaCoincidencia;
  /** a agenda já buscada pela fila (cobre a janela de todos os pedidos) */
  itens: AgendaItem[];
  carregando: boolean;
  erro: string;
  porSetor: boolean;
  hoje: string;
  onClose: () => void;
  footer?: React.ReactNode;
}) {
  const { de, ate } = janelaDoPedido(pedido.startDate, pedido.endDate);
  const coincidem = coincidenciasDoPedido(itens, pedido, porSetor);
  const coincideSet = new Set(coincidem.map((c) => c.userId));

  // uma linha por pessoa: o colaborador do pedido primeiro, depois quem
  // coincide, depois o resto da equipe com férias na janela
  const porPessoa = new Map<string, TimelineLinha & { primeiro: string }>();
  for (const i of daEquipe(itens, pedido, porSetor)) {
    if (!cruza(i, de, ate)) continue;
    const tipo: TipoNaTimeline =
      i.userId === pedido.userId && i.status === "solicitada" && i.inicio === pedido.startDate && i.fim === pedido.endDate
        ? "pedido"
        : i.status;
    const l = porPessoa.get(i.userId) ?? { userId: i.userId, nome: i.nome, itens: [], primeiro: i.inicio };
    l.itens.push({ inicio: i.inicio, fim: i.fim, tipo });
    if (i.inicio < l.primeiro) l.primeiro = i.inicio;
    porPessoa.set(i.userId, l);
  }
  // o próprio pedido, mesmo que a agenda não o traga (unidade fora do filtro do topo)
  const dono = porPessoa.get(pedido.userId) ?? { userId: pedido.userId, nome: pedido.fullName, itens: [], primeiro: pedido.startDate };
  if (!dono.itens.some((i) => i.tipo === "pedido")) dono.itens.push({ inicio: pedido.startDate, fim: pedido.endDate, tipo: "pedido" });
  porPessoa.delete(pedido.userId);
  const ordem = (a: { primeiro: string; nome: string | null }, b: { primeiro: string; nome: string | null }) =>
    a.primeiro.localeCompare(b.primeiro) || (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR");
  const outros = [...porPessoa.values()];
  const linhas: TimelineLinha[] = [
    dono,
    ...outros.filter((l) => coincideSet.has(l.userId)).sort(ordem),
    ...outros.filter((l) => !coincideSet.has(l.userId)).sort(ordem),
  ];

  const quem = porSetor ? `do setor${pedido.departmentName ? ` ${pedido.departmentName}` : ""}` : "da equipe";

  return (
    <DetailModal open onClose={onClose} width="lg" title={`Férias ${porSetor ? "do setor" : "da equipe"}`} footer={footer}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
        <p style={{ margin: 0, fontSize: "0.88rem" }}>
          <strong>{shortName(pedido.fullName)}</strong> pediu {formatDate(pedido.startDate)} a {formatDate(pedido.endDate)} ({pedido.dias} dias).
        </p>

        {erro ? (
          <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--mh-danger)" }}>{erro}</p>
        ) : carregando ? (
          <p className="soft" style={{ margin: 0, fontSize: "0.82rem" }}>Buscando as férias {quem}…</p>
        ) : coincidem.length === 0 ? (
          <p className="soft" style={{ margin: 0, fontSize: "0.84rem" }}>
            Ninguém {quem} tem férias nesse período.
          </p>
        ) : (
          <div style={{ background: "var(--mh-warning-soft)", color: "var(--mh-warning)", borderRadius: 8, padding: "0.6rem 0.75rem", fontSize: "0.84rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700 }}>
              <AlertTriangle size={15} aria-hidden />
              Coincide com {coincidem.length} {coincidem.length === 1 ? "pessoa" : "pessoas"} {quem}
            </div>
            <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.35rem" }}>
              {coincidem.map((c) => <li key={c.userId}>{descreverCoincidencia(c)}</li>)}
            </ul>
          </div>
        )}

        {!carregando && !erro && (
          <div style={{ maxHeight: "55vh", overflowY: "auto" }}>
            <FeriasTimeline
              linhas={linhas} janelaInicio={de} janelaFim={ate} hoje={hoje}
              destaque={{ inicio: pedido.startDate, fim: pedido.endDate }} semCartao
            />
          </div>
        )}

        <p className="soft" style={{ margin: 0, fontSize: "0.74rem" }}>
          {porSetor
            ? "Em Toda a empresa, a comparação é com o setor do colaborador. A faixa clara marca o período pedido."
            : "A comparação é com a sua equipe, a mesma do topo da tela. A faixa clara marca o período pedido."}
        </p>
      </div>
    </DetailModal>
  );
}
