/**
 * Classificação da lista de Ações (LUIZ, 24/11/2026): Data de criação, Status ou Prazo.
 *
 * A lista pagina no banco, então a ordem é decidida lá (`search_action_ids`, chaves
 * `ord` e `dir` do filtro): ordenar só na tela arrumaria a página aberta e deixaria
 * as outras como estavam.
 *
 * Mora num módulo neutro pelo mesmo motivo de `acoes-status.ts`: a página (Server
 * Component) lê a URL e o componente (Client) escreve nela.
 */

export type OrdemPor = "criada" | "status" | "prazo";
export type Sentido = "asc" | "desc";
export type OrdemAcoes = { por: OrdemPor; dir: Sentido };

/** parâmetros na URL: ausentes = a ordem padrão */
export const ORDEM_PARAM = "ord";
export const SENTIDO_PARAM = "dir";

/** a de sempre: a mais nova primeiro */
export const ORDEM_PADRAO: OrdemAcoes = { por: "criada", dir: "desc" };

/**
 * Sentido do PRIMEIRO clique numa coluna, o que se espera dela: a mais nova, o
 * mais urgente e o prazo mais perto. O segundo clique inverte.
 */
export const SENTIDO_INICIAL: Record<OrdemPor, Sentido> = { criada: "desc", status: "asc", prazo: "asc" };

/** a ordem que a URL pediu, já validada; lixo vira o padrão */
export function resolverOrdem(ord: string | undefined, dir: string | undefined): OrdemAcoes {
  const por: OrdemPor = ord === "status" || ord === "prazo" ? ord : "criada";
  const sentido: Sentido = dir === "asc" || dir === "desc" ? dir : SENTIDO_INICIAL[por];
  return { por, dir: sentido };
}

export const ehOrdemPadrao = (o: OrdemAcoes) => o.por === ORDEM_PADRAO.por && o.dir === ORDEM_PADRAO.dir;

/** clicar numa coluna: a mesma inverte o sentido, outra entra no sentido dela */
export function proximaOrdem(atual: OrdemAcoes, por: OrdemPor): OrdemAcoes {
  if (atual.por === por) return { por, dir: atual.dir === "asc" ? "desc" : "asc" };
  return { por, dir: SENTIDO_INICIAL[por] };
}
