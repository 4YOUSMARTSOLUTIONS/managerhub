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
 * empresa inteira, então ali a comparação é dentro do setor, e a linha do
 * tempo mostra a empresa em blocos, um por setor.
 *
 * O alerta da linha do tempo aponta QUALQUER par de pessoas com férias ao
 * mesmo tempo, não só os pedidos aguardando: dois períodos já aprovados que se
 * cruzam num dia também são problema (LUIZ, 12/11/2026, SARAH e PAULO em
 * 02/08/2027 sem alerta nenhum). Só conta o que ainda não terminou: férias
 * juntas que já passaram não pedem decisão nenhuma.
 *
 * Em "Toda a empresa" nenhum alerta de coincidência aparece (LUIZ,
 * 12/11/2026): com a empresa inteira, mesmo por setor, a lista virava ruído.
 * A linha do tempo continua, por setor.
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
 * A janela da linha do tempo da equipe: um ano a partir do 1º dia do mês atual
 * (a tela rola para o lado), esticada até o fim do mês do último pedido aguardando.
 */
export function janelaDaEquipe(hoje: string, pedidos: { startDate: string; endDate: string }[]): { de: string; ate: string } {
  const h = new Date(`${hoje}T12:00:00`);
  let de = iso(new Date(h.getFullYear(), h.getMonth(), 1, 12));
  let ate = iso(new Date(h.getFullYear(), h.getMonth() + 12, 0, 12));
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

/** dias corridos entre duas datas ISO, contando as duas pontas */
const diasEntre = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000) + 1;

/**
 * Um período de férias para a conta de coincidência. Vem da agenda (linha do
 * tempo de Aprovações) ou do painel (Visão geral), cada um com o seu rótulo.
 */
export type PeriodoParaCoincidencia = {
  chave: string;
  userId: string;
  nome: string | null;
  inicio: string;
  fim: string;
  /** como o período aparece no alerta: "efetivada", "aprovada pelo gestor"... */
  situacao: string;
  /** pedido aguardando a decisão de quem olha: os pares dele vêm primeiro */
  destaque?: boolean;
};

export type ParCoincidente = {
  a: PeriodoParaCoincidencia;
  b: PeriodoParaCoincidencia;
  de: string;
  ate: string;
  destaque: boolean;
};

/**
 * Todo par de pessoas com férias ao mesmo tempo entre `de` e `ate`; o par que
 * termina antes de `de` (passado) fica fora. Os pares com pedido aguardando
 * aprovação vêm primeiro; depois, pela data.
 */
export function paresCoincidentes(
  periodos: PeriodoParaCoincidencia[], de: string, ate: string,
): ParCoincidente[] {
  const pares: ParCoincidente[] = [];
  for (let x = 0; x < periodos.length; x++) {
    for (let y = x + 1; y < periodos.length; y++) {
      const [a, b] = periodos[x].inicio <= periodos[y].inicio ? [periodos[x], periodos[y]] : [periodos[y], periodos[x]];
      if (a.userId === b.userId) continue;
      const ini = a.inicio > b.inicio ? a.inicio : b.inicio;
      const fim = a.fim < b.fim ? a.fim : b.fim;
      if (ini > fim || fim < de || ini > ate) continue;
      pares.push({ a, b, de: ini, ate: fim, destaque: Boolean(a.destaque || b.destaque) });
    }
  }
  return pares.sort((p, q) => Number(q.destaque) - Number(p.destaque) || p.de.localeCompare(q.de));
}

/** quantos pares o alerta lista antes de resumir o resto */
const MAX_PARES = 12;

/**
 * O alerta amarelo das coincidências: quem fica de férias junto com quem, e
 * quando. Sem par nenhum, não aparece.
 */
export function AlertaDeCoincidencias({ pares, quem }: { pares: ParCoincidente[]; quem: string }) {
  if (pares.length === 0) return null;
  const periodo = (x: PeriodoParaCoincidencia) => `${formatDate(x.inicio)} a ${formatDate(x.fim)}, ${x.situacao}`;
  return (
    <div style={{ background: "var(--mh-warning-soft)", color: "var(--mh-warning)", borderRadius: 8, padding: "0.6rem 0.75rem", fontSize: "0.84rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700 }}>
        <AlertTriangle size={15} aria-hidden />
        {pares.length === 1 ? "1 coincidência" : `${pares.length} coincidências`} de férias {quem}
      </div>
      <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.35rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {pares.slice(0, MAX_PARES).map((c) => {
          const dias = diasEntre(c.de, c.ate);
          return (
            <li key={`${c.a.chave}|${c.b.chave}`}>
              <strong>{shortName(c.a.nome)}</strong> ({periodo(c.a)}) e <strong>{shortName(c.b.nome)}</strong> ({periodo(c.b)}):{" "}
              {dias === 1
                ? `juntos em ${formatDate(c.de)}`
                : `juntos de ${formatDate(c.de)} a ${formatDate(c.ate)} (${dias} dias)`}
            </li>
          );
        })}
      </ul>
      {pares.length > MAX_PARES && (
        <p style={{ margin: "0.35rem 0 0" }}>e mais {pares.length - MAX_PARES}, na linha do tempo abaixo.</p>
      )}
    </div>
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
  const naJanela = itens.filter((i) => cruza(i, de, ate));

  type Linha = TimelineLinha & { primeiro: string; temPedido: boolean };
  const porPessoa = new Map<string, Linha>();
  for (const i of naJanela) {
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

  // só na equipe, e de hoje em diante (o que já passou não pede decisão)
  const deHoje = hoje > de ? hoje : de;
  const pares = porSetor ? [] : paresCoincidentes(
    naJanela.map((i) => ({
      chave: i.chave, userId: i.userId, nome: i.nome, inicio: i.inicio, fim: i.fim,
      situacao: naFila(i) ? "aguardando sua aprovação" : ROTULO_STATUS[i.status],
      destaque: naFila(i),
    })),
    deHoje, ate);

  return (
    <DetailModal open onClose={onClose} width="lg" title={porSetor ? "Férias por setor" : "Férias da equipe"}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
        {erro ? (
          <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--mh-danger)" }}>{erro}</p>
        ) : carregando ? (
          <p className="soft" style={{ margin: 0, fontSize: "0.82rem" }}>Buscando as férias…</p>
        ) : (
          <>
            {!porSetor && (pares.length === 0 ? (
              linhas.length > 0 && (
                <p className="soft" style={{ margin: 0, fontSize: "0.84rem" }}>
                  Ninguém da equipe tem férias ao mesmo tempo entre {formatDate(deHoje)} e {formatDate(ate)}.
                </p>
              )
            ) : (
              <AlertaDeCoincidencias pares={pares} quem="na equipe" />
            ))}

            {linhas.length === 0 ? (
              <p className="soft" style={{ margin: 0, fontSize: "0.84rem" }}>
                Ninguém tem férias entre {formatDate(de)} e {formatDate(ate)}.
              </p>
            ) : (
              <FeriasTimeline linhas={linhas} janelaInicio={de} janelaFim={ate} hoje={hoje} semCartao alturaMax="55vh" />
            )}
          </>
        )}

        <p className="soft" style={{ margin: 0, fontSize: "0.74rem" }}>
          {porSetor
            ? "Em Toda a empresa, as pessoas aparecem por setor, sem o alerta de coincidência."
            : "A equipe é a mesma do topo da tela."}
          {" "}Entram as férias efetivadas, as aprovadas pelo gestor e as que aguardam aprovação.
        </p>
      </div>
    </DetailModal>
  );
}
