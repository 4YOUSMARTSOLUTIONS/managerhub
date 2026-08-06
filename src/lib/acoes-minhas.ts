/**
 * "Minhas ações", por papel.
 *
 * Mora aqui, e não dentro de `ActionsManager`, porque as duas pontas precisam do
 * MESMO valor em tempo de execução: a página (Server Component) resolve o padrão
 * e o componente (Client) desenha os botões.
 *
 * Constante exportada de um arquivo `"use client"` NÃO atravessa para o servidor:
 * o que chega lá é um proxy de referência de cliente, e qualquer uso real
 * (`.includes`, spread) estoura em tempo de execução. O `tsc` e o `next build`
 * passam, porque o tipo continua certo; só a tela quebra. Foi exatamente o que
 * aconteceu quando isto nasceu dentro do componente.
 */

/**
 * Os valores são os mesmos na URL, aqui e no banco (`search_action_ids`): um
 * vocabulário só, sem tabela de tradução no meio para sair de sincronia.
 */
export const MINHA_PAPEIS = ["resp", "sol", "cri"] as const;
export type MinhaPapel = (typeof MINHA_PAPEIS)[number];

export const PAPEL_LABEL: Record<MinhaPapel, string> = {
  resp: "Responsável",
  sol: "Solicitante",
  cri: "Criador",
};

export const PAPEL_HINT: Record<MinhaPapel, string> = {
  resp: "Ações em que você é responsável por alguma demanda",
  sol: "Ações abertas a seu pedido",
  cri: "Ações que você registrou no sistema",
};

/** o que a tela abre marcado quando a URL não diz nada */
export const MINHA_PADRAO: MinhaPapel[] = ["resp"];

/** sentinela de "Todas": ausente na URL significa o padrão, então desligar precisa ser explícito */
export const MINHA_TODAS = "todas";

/** nome do parâmetro na URL */
export const MINHA_PARAM = "minhas";

/** o que a URL pediu, já validado. Ausente = padrão; sentinela ou lixo = todas. */
export function resolverMinhas(naUrl: string[]): MinhaPapel[] {
  if (naUrl.length === 0) return MINHA_PADRAO;
  return naUrl.filter((v): v is MinhaPapel => (MINHA_PAPEIS as readonly string[]).includes(v));
}
