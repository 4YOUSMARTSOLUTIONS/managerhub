"use client";

import { AlertTriangle } from "lucide-react";
import { DetailModal } from "@/components/ui/DetailModal";
import { FeriasTimeline, type TimelineLinha, type TipoNaTimeline } from "@/components/FeriasTimeline";
import type { AgendaItem } from "@/lib/ferias-agenda";
import { formatDate, shortName } from "@/lib/format";

/*
 * Coincidência de férias na aprovação (LUIZ, 12/11/2026): quem decide um
 * pedido precisa ver se mais alguém da equipe estará fora no mesmo período.
 * Cada pedido da fila mostra o alerta em amarelo, e um ícone só, no topo de
 * Aprovações, abre a linha do tempo da equipe inteira com os pedidos que
 * aguardam aprovação em destaque.
 *
 * "Equipe" é o recorte que a tela já usa: a cadeia de quem é só gestor (a RLS
 * já entrega só ela) ou o "Minha equipe" do topo. Em "Toda a empresa" seria a
 * empresa inteira, então ali a comparação é com o setor do colaborador, e a
 * linha do tempo mostra só os setores com pedido aguardando, um por bloco.
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

/**
 * A janela da linha do tempo da equipe: do 1º dia do mês atual até o fim do
 * quinto mês seguinte, esticada até o fim do mês do último pedido aguardando.
 */
export function janelaDaEquipe(hoje: string, pedidos: { startDate: string; endDate: string }[]): { de: string; ate: string } {
  const h = new Date(`${hoje}T12:00:00`);
  let de = iso(new Date(h.getFullYear(), h.getMonth(), 1, 12));
  let ate = iso(new Date(h.getFullYear(), h.getMonth() + 6, 0, 12));
  for (const p of pedidos) {
    const a = new Date(`${p.startDate}T12:00:00`);
    const b = new Date(`${p.endDate}T12:00:00`);
    const ini = iso(new Date(a.getFullYear(), a.getMonth(), 1, 12));
    const fim = iso(new Date(b.getFullYear(), b.getMonth() + 1, 0, 12));
    if (ini < de) de = ini;
    if (fim > ate) ate = fim;
  }
  return { de, ate };
}

const cruza = (i: { inicio: string; fim: string }, de: string, ate: string) => i.inicio <= ate && i.fim >= de;

/** o setor do colaborador do pedido: pelo id quando a agenda traz o pedido, senão pelo nome */
function setorDoPedido(itens: AgendaItem[], p: PedidoParaCoincidencia): { id: string | null; nome: string | null } {
  const doPedido = itens.find((i) => i.userId === p.userId);
  return { id: doPedido?.setorId ?? null, nome: doPedido?.setor ?? p.departmentName };
}

const doSetor = (i: AgendaItem, s: { id: string | null; nome: string | null }) =>
  s.id ? i.setorId === s.id : Boolean(s.nome) && i.setor === s.nome;

/** quem mais estará de férias (efetivada, aprovada ou pedida) dentro do período pedido */
export function coincidenciasDoPedido(
  itens: AgendaItem[], p: PedidoParaCoincidencia, porSetor: boolean,
): { userId: string; nome: string | null; periodos: AgendaItem[] }[] {
  const setor = porSetor ? setorDoPedido(itens, p) : null;
  const porPessoa = new Map<string, { userId: string; nome: string | null; periodos: AgendaItem[] }>();
  for (const i of itens) {
    if (i.userId === p.userId || !cruza(i, p.startDate, p.endDate)) continue;
    if (setor && !doSetor(i, setor)) continue;
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

/** o alerta amarelo de um pedido: quantas pessoas coincidem */
export function AlertaCoincidencia({ qtd, porSetor }: { qtd: number; porSetor: boolean }) {
  if (qtd === 0) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "0.3rem", color: "var(--mh-warning)",
      fontSize: "0.75rem", fontWeight: 600,
    }}>
      <AlertTriangle size={12} aria-hidden style={{ flexShrink: 0 }} />
      Coincide com {qtd} {qtd === 1 ? "pessoa" : "pessoas"} {porSetor ? "do setor" : "da equipe"}
    </span>
  );
}

/** a linha do tempo da equipe inteira, com os pedidos aguardando em destaque e o alerta de quem coincide */
export function LinhaDoTempoDaEquipe({
  pedidos, itens, carregando, erro, porSetor, hoje, onClose,
}: {
  /** a fila de Aprovações */
  pedidos: PedidoParaCoincidencia[];
  /** a agenda já buscada pela fila (cobre a janela) */
  itens: AgendaItem[];
  carregando: boolean;
  erro: string;
  porSetor: boolean;
  hoje: string;
  onClose: () => void;
}) {
  const { de, ate } = janelaDaEquipe(hoje, pedidos);
  const naFila = (i: AgendaItem) =>
    i.status === "solicitada" && pedidos.some((p) => p.userId === i.userId && p.startDate === i.inicio && p.endDate === i.fim);

  // Em "Toda a empresa", só os setores que têm pedido aguardando
  const setores = porSetor ? pedidos.map((p) => setorDoPedido(itens, p)) : [];
  const entra = (i: AgendaItem) => !porSetor || setores.some((s) => doSetor(i, s));

  type Linha = TimelineLinha & { primeiro: string; temPedido: boolean };
  const porPessoa = new Map<string, Linha>();
  for (const i of itens) {
    if (!cruza(i, de, ate) || !entra(i)) continue;
    const pendente = naFila(i);
    const tipo: TipoNaTimeline = pendente ? "pendente" : i.status;
    const l = porPessoa.get(i.userId)
      ?? { userId: i.userId, nome: i.nome, itens: [], primeiro: i.inicio, temPedido: false, grupo: porSetor ? (i.setor ?? "Sem setor") : undefined };
    l.itens.push({ inicio: i.inicio, fim: i.fim, tipo });
    if (i.inicio < l.primeiro) l.primeiro = i.inicio;
    if (pendente) l.temPedido = true;
    porPessoa.set(i.userId, l);
  }
  // o pedido aparece mesmo que a agenda não o traga (unidade fora do filtro do topo)
  for (const p of pedidos) {
    const l = porPessoa.get(p.userId)
      ?? { userId: p.userId, nome: p.fullName, itens: [], primeiro: p.startDate, temPedido: true, grupo: porSetor ? (p.departmentName ?? "Sem setor") : undefined };
    if (!l.itens.some((i) => i.tipo === "pendente" && i.inicio === p.startDate && i.fim === p.endDate)) {
      l.itens.push({ inicio: p.startDate, fim: p.endDate, tipo: "pendente" });
    }
    l.temPedido = true;
    if (p.startDate < l.primeiro) l.primeiro = p.startDate;
    porPessoa.set(p.userId, l);
  }

  // por setor (quando há), quem tem pedido aguardando primeiro, depois pela data
  const linhas: TimelineLinha[] = [...porPessoa.values()].sort((a, b) =>
    (a.grupo ?? "").localeCompare(b.grupo ?? "", "pt-BR")
    || Number(b.temPedido) - Number(a.temPedido)
    || a.primeiro.localeCompare(b.primeiro)
    || (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR"));

  const conflitos = pedidos
    .map((p) => ({ p, com: coincidenciasDoPedido(itens, p, porSetor) }))
    .filter((c) => c.com.length > 0);
  const quem = porSetor ? "do setor" : "da equipe";

  return (
    <DetailModal open onClose={onClose} width="lg" title={porSetor ? "Férias por setor" : "Férias da equipe"}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
        {erro ? (
          <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--mh-danger)" }}>{erro}</p>
        ) : carregando ? (
          <p className="soft" style={{ margin: 0, fontSize: "0.82rem" }}>Buscando as férias {quem}…</p>
        ) : (
          <>
            {pedidos.length > 0 && (conflitos.length === 0 ? (
              <p className="soft" style={{ margin: 0, fontSize: "0.84rem" }}>
                Nenhum pedido aguardando aprovação coincide com as férias de outra pessoa {quem}.
              </p>
            ) : (
              <div style={{ background: "var(--mh-warning-soft)", color: "var(--mh-warning)", borderRadius: 8, padding: "0.6rem 0.75rem", fontSize: "0.84rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700 }}>
                  <AlertTriangle size={15} aria-hidden />
                  {conflitos.length === 1 ? "1 pedido coincide" : `${conflitos.length} pedidos coincidem`} com as férias de outras pessoas {quem}
                </div>
                <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.35rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                  {conflitos.map(({ p, com }) => (
                    <li key={p.id}>
                      <strong>{shortName(p.fullName)}</strong> ({formatDate(p.startDate)} a {formatDate(p.endDate)}) coincide
                      com {com.map(descreverCoincidencia).join("; ")}
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {linhas.length === 0 ? (
              <p className="soft" style={{ margin: 0, fontSize: "0.84rem" }}>
                Ninguém {quem} tem férias entre {formatDate(de)} e {formatDate(ate)}.
              </p>
            ) : (
              <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
                <FeriasTimeline linhas={linhas} janelaInicio={de} janelaFim={ate} hoje={hoje} semCartao />
              </div>
            )}
          </>
        )}

        <p className="soft" style={{ margin: 0, fontSize: "0.74rem" }}>
          {porSetor
            ? "Em Toda a empresa, aparecem só os setores com pedido aguardando aprovação, e a comparação é dentro do setor."
            : "A equipe é a mesma do topo da tela."}
          {" "}Entram as férias efetivadas, as aprovadas pelo gestor e as que aguardam aprovação.
        </p>
      </div>
    </DetailModal>
  );
}
