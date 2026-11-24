import { isOverdue, normalizar, shortName } from "@/lib/format";
import type { TicketRow } from "@/components/TicketsManager";

/**
 * Filtros da lista de Chamados (LUIZ, 23/11/2026). A tela já tem todos os chamados
 * que a pessoa pode ver, então o recorte roda no navegador e responde na hora.
 *
 * Unidade fica de fora de propósito: quem recorta unidade é o seletor do topo.
 */

export type StatusChamado =
  | "aberto" | "em_atendimento" | "aguardando" | "aguardando_acordo" | "atrasado"
  | "resolvido" | "fechado" | "cancelado";

/** os mesmos nomes que a coluna Status mostra (`ticketStatusView`) */
export const STATUS_CHAMADO_LABEL: Record<StatusChamado, string> = {
  aberto: "Aberto",
  em_atendimento: "Em atendimento",
  aguardando: "Aguardando",
  aguardando_acordo: "Aguardando de acordo",
  atrasado: "Atrasado",
  resolvido: "Resolvido",
  fechado: "Fechado",
  cancelado: "Cancelado",
};

/**
 * A tela abre no que ainda não terminou. "Em atendimento" entra junto de "Aberto"
 * porque é o nome que o sistema dá ao chamado que já tem responsável: no SAVI ele
 * se chamava justamente "Aberto", e sem isso o chamado em andamento sumiria.
 */
export const STATUS_CHAMADO_PADRAO: StatusChamado[] = [
  "aberto", "em_atendimento", "aguardando", "aguardando_acordo", "atrasado",
];

/** opção "sem setor", "sem categoria", "sem responsável" */
export const SEM_VALOR = "__sem__";

export type FiltrosChamado = {
  q: string;
  status: string[];
  setor: string[];
  categoria: string[];
  prioridade: string[];
  solicitante: string[];
  responsavel: string[];
  abertoDe: string;
  abertoAte: string;
  prazoDe: string;
  prazoAte: string;
  conclusaoDe: string;
  conclusaoAte: string;
  cumprimento: string[];
  avaliacao: string[];
  anexos: string[];
  origem: string[];
};

export const FILTROS_VAZIOS: FiltrosChamado = {
  q: "", status: [], setor: [], categoria: [], prioridade: [], solicitante: [], responsavel: [],
  abertoDe: "", abertoAte: "", prazoDe: "", prazoAte: "", conclusaoDe: "", conclusaoAte: "",
  cumprimento: [], avaliacao: [], anexos: [], origem: [],
};

export const filtrosPadrao = (): FiltrosChamado => ({ ...FILTROS_VAZIOS, status: [...STATUS_CHAMADO_PADRAO] });

export const OPCOES_CUMPRIMENTO = [
  { value: "dentro", label: "Dentro do prazo" },
  { value: "fora", label: "Fora do prazo" },
  { value: "sem_prazo", label: "Sem prazo" },
];
export const OPCOES_AVALIACAO = [
  { value: "com", label: "Avaliado" },
  { value: "sem", label: "Sem avaliação" },
];
export const OPCOES_ANEXOS = [
  { value: "com", label: "Com anexo" },
  { value: "sem", label: "Sem anexo" },
];
export const OPCOES_ORIGEM = [
  { value: "sistema", label: "Aberto no Manager HUB" },
  { value: "importado", label: "Importado" },
];

const ENCERRADOS = ["resolved", "closed", "cancelled"];

/** mesma precedência de `ticketStatusView`: o que o filtro chama de Atrasado é o que a linha mostra */
export function statusDoChamado(t: Pick<TicketRow, "status" | "dueDate" | "approvalRequestedAt">): StatusChamado {
  if (t.status === "resolved") return "resolvido";
  if (t.status === "closed") return "fechado";
  if (t.status === "cancelled") return "cancelado";
  if (t.approvalRequestedAt) return "aguardando_acordo";
  if (isOverdue(t.dueDate)) return "atrasado";
  if (t.status === "in_progress") return "em_atendimento";
  if (t.status === "waiting") return "aguardando";
  return "aberto";
}

function cumprimentoDoChamado(t: TicketRow): string {
  if (!t.dueDate) return "sem_prazo";
  if (ENCERRADOS.includes(t.status)) {
    if (!t.resolvedAt) return "sem_prazo";
    return new Date(t.resolvedAt) <= new Date(t.dueDate) ? "dentro" : "fora";
  }
  return isOverdue(t.dueDate) ? "fora" : "dentro";
}

const diaBrasil = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
});

/** o dia no horário de Brasília: um chamado das 22h não pode cair no dia seguinte (UTC) */
function noPeriodo(iso: string | null, de: string, ate: string): boolean {
  if (!de && !ate) return true;
  if (!iso) return false;
  const dia = diaBrasil.format(new Date(iso));
  return (!de || dia >= de) && (!ate || dia <= ate);
}

const naLista = (lista: string[], valor: string | null | undefined) =>
  lista.length === 0 || lista.includes(valor || SEM_VALOR);

const chaveCategoria = (t: Pick<TicketRow, "categoryId" | "categoryName">) => t.categoryId ?? t.categoryName ?? SEM_VALOR;

/**
 * "#12" procura exatamente o chamado 12. Só "12" também aceita título com esse
 * número. O resto procura no título.
 */
function casaBusca(t: TicketRow, termo: string): boolean {
  if (!termo) return true;
  const numero = /^#\s*(\d+)$/.exec(termo)?.[1];
  if (numero) return (t.code ?? "") === numero;
  if (/^\d+$/.test(termo) && (t.code ?? "") === termo) return true;
  return normalizar(t.title).includes(termo);
}

export function filtrarChamados(linhas: TicketRow[], f: FiltrosChamado): TicketRow[] {
  const termo = normalizar(f.q).trim();
  return linhas.filter((t) =>
    casaBusca(t, termo)
    && (f.status.length === 0 || f.status.includes(statusDoChamado(t)))
    && naLista(f.setor, t.sectorName)
    && (f.categoria.length === 0 || f.categoria.includes(chaveCategoria(t)))
    && (f.prioridade.length === 0 || f.prioridade.includes(t.priority))
    && naLista(f.solicitante, t.requesterName)
    && naLista(f.responsavel, t.assigneeName)
    && noPeriodo(t.createdAt, f.abertoDe, f.abertoAte)
    && noPeriodo(t.dueDate, f.prazoDe, f.prazoAte)
    && noPeriodo(t.resolvedAt, f.conclusaoDe, f.conclusaoAte)
    && (f.cumprimento.length === 0 || f.cumprimento.includes(cumprimentoDoChamado(t)))
    && (f.avaliacao.length === 0 || f.avaliacao.includes(t.npsScore != null ? "com" : "sem"))
    && (f.anexos.length === 0 || f.anexos.includes(t.attachments.length > 0 ? "com" : "sem"))
    && (f.origem.length === 0 || f.origem.includes(t.importado ? "importado" : "sistema")));
}

/** Prazo mais antigo primeiro; quem não tem prazo vai para o fim (LUIZ, 23/11/2026). */
export function ordenarPorPrazo(linhas: TicketRow[]): TicketRow[] {
  return linhas
    .map((t) => ({ t, prazo: t.dueDate ? new Date(t.dueDate).getTime() : Number.POSITIVE_INFINITY }))
    .sort((a, b) => (a.prazo === b.prazo
      ? a.t.createdAt.localeCompare(b.t.createdAt) || a.t.id.localeCompare(b.t.id)
      : a.prazo < b.prazo ? -1 : 1))
    .map(({ t }) => t);
}

/** quantos filtros estão em uso; as duas pontas de um período contam como um */
export function contarFiltros(f: FiltrosChamado): number {
  const listas = [f.status, f.setor, f.categoria, f.prioridade, f.solicitante, f.responsavel, f.cumprimento, f.avaliacao, f.anexos, f.origem];
  return listas.filter((l) => l.length > 0).length
    + (f.q.trim() ? 1 : 0)
    + (f.abertoDe || f.abertoAte ? 1 : 0)
    + (f.prazoDe || f.prazoAte ? 1 : 0)
    + (f.conclusaoDe || f.conclusaoAte ? 1 : 0);
}

const emOrdem = <T extends { label: string }>(l: T[]) => l.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

/** nome reduzido na lista, com o valor inteiro por trás; homônimo reduzido mostra o nome todo */
function opcoesDePessoas(nomes: Iterable<string>) {
  const lista = [...new Set(nomes)];
  const vezes = new Map<string, number>();
  for (const n of lista) vezes.set(shortName(n), (vezes.get(shortName(n)) ?? 0) + 1);
  return emOrdem(lista.map((n) => ({ value: n, label: (vezes.get(shortName(n)) ?? 0) > 1 ? n : shortName(n) })));
}

/** As opções saem dos próprios chamados: nenhuma escolha leva a uma lista que nunca teria resultado. */
export function opcoesDosChamados(linhas: TicketRow[], setoresEscolhidos: string[]) {
  const setores = new Set<string>();
  const solicitantes = new Set<string>();
  const responsaveis = new Set<string>();
  const categorias = new Map<string, { nome: string; setores: Set<string> }>();
  let semSetor = false, semCategoria = false, semSolicitante = false, semResponsavel = false;

  for (const t of linhas) {
    if (t.sectorName) setores.add(t.sectorName); else semSetor = true;
    if (t.requesterName) solicitantes.add(t.requesterName); else semSolicitante = true;
    if (t.assigneeName) responsaveis.add(t.assigneeName); else semResponsavel = true;
    if (!t.categoryName) { semCategoria = true; continue; }
    const k = chaveCategoria(t);
    const c = categorias.get(k) ?? { nome: t.categoryName, setores: new Set<string>() };
    c.setores.add(t.sectorName ?? SEM_VALOR);
    categorias.set(k, c);
  }

  // categoria segue o setor escolhido; "Outros" existe em mais de um, e aí leva o setor no nome
  const visiveis = [...categorias.entries()].filter(([, c]) =>
    setoresEscolhidos.length === 0 || [...c.setores].some((s) => setoresEscolhidos.includes(s)));
  const repetidas = new Map<string, number>();
  for (const [, c] of visiveis) repetidas.set(c.nome, (repetidas.get(c.nome) ?? 0) + 1);

  const comSem = <T extends { value: string; label: string }>(l: T[], tem: boolean, rotulo: string) =>
    tem ? [{ value: SEM_VALOR, label: rotulo }, ...l] : l;

  return {
    setores: comSem(emOrdem([...setores].map((s) => ({ value: s, label: s }))), semSetor, "Sem setor"),
    categorias: comSem(emOrdem(visiveis.map(([k, c]) => ({
      value: k,
      label: (repetidas.get(c.nome) ?? 0) > 1 ? `${c.nome} (${[...c.setores].filter((s) => s !== SEM_VALOR).join(", ")})` : c.nome,
    }))), semCategoria, "Sem categoria"),
    solicitantes: comSem(opcoesDePessoas(solicitantes), semSolicitante, "Sem solicitante"),
    responsaveis: comSem(opcoesDePessoas(responsaveis), semResponsavel, "Sem responsável"),
  };
}
