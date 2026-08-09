/**
 * Ordenação dos cartões e colunas do Planner.
 *
 * A posição é um inteiro ESPARSO: o primeiro item entra em 1024, o seguinte em
 * 2048, e mover é assumir o ponto médio dos dois vizinhos. Assim um arraste
 * custa UM update, e não a reescrita da coluna inteira.
 *
 * O preço do esquema é a colisão: entre 1024 e 1025 não existe ponto médio
 * inteiro. Quando isso acontece, quem move renormaliza a coluna (1024, 2048,
 * 3072…) e tenta de novo. A colisão só chega depois de ~10 inserções seguidas
 * no MESMO vão (2^10 = 1024), então a renormalização é rara.
 *
 * Fica fora da server action porque as duas pontas usam a mesma conta: o
 * servidor grava, e o cliente prevê a posição no estado otimista. Se cada lado
 * calculasse do seu jeito, o cartão pularia de lugar quando o refresh chegasse.
 */

export const PASSO = 1024;

/** posição para entrar no FIM de uma lista (a mais comum: criar cartão) */
export function posicaoNoFim(posicoes: number[]): number {
  if (posicoes.length === 0) return PASSO;
  return Math.max(...posicoes) + PASSO;
}

/**
 * Posição entre dois vizinhos, ou `null` quando não existe inteiro entre eles
 * (colisão: é a senha para renormalizar antes de tentar de novo).
 *
 * `antes = null` significa "primeiro da lista"; `depois = null`, "último".
 */
export function posicaoEntre(antes: number | null, depois: number | null): number | null {
  if (antes == null && depois == null) return PASSO;
  if (antes == null) {
    // primeiro da lista: metade do primeiro atual, e colide quando ele chega a 1
    const p = Math.floor((depois as number) / 2);
    return p >= 1 && p < (depois as number) ? p : null;
  }
  if (depois == null) return antes + PASSO;
  const meio = Math.floor((antes + depois) / 2);
  return meio > antes && meio < depois ? meio : null;
}

/**
 * A lista renormalizada: mesma ordem, posições 1024, 2048, 3072…
 * Devolve pares (id, posição) para o update em lote.
 */
export function renormalizar<T extends { id: string; position: number }>(
  itens: T[],
): { id: string; position: number }[] {
  return [...itens]
    .sort((a, b) => a.position - b.position)
    .map((x, i) => ({ id: x.id, position: (i + 1) * PASSO }));
}
