/**
 * Lê TODAS as linhas de uma consulta, página por página.
 *
 * O PostgREST corta toda resposta em 1000 linhas (o `max-rows` do projeto), e
 * `.limit(20000)` NÃO fura esse teto: ele só pede menos, nunca mais. O corte
 * não vira erro, vira lista mais curta. Enquanto a empresa tinha menos de mil
 * vínculos isso não aparecia; no dia em que a base passou de 1000, a tela de
 * colaboradores passou a mostrar exatamente "1000" e três pessoas sumiram sem
 * aviso nenhum, junto com as unidades e os nomes de mais algumas.
 *
 * Toda leitura que pode devolver "uma linha por pessoa da empresa" passa por
 * aqui: `memberships`, `profiles`, `membership_units` e o que se cruza com eles.
 *
 * A consulta PRECISA vir com `.order(...)` estável. Sem ordem, a página 2 pode
 * repetir linha da página 1 e pular outra, e o defeito troca de cara: em vez de
 * faltar gente no fim, falta gente no meio.
 *
 * Recebe uma FÁBRICA, e não a consulta pronta, porque o builder do supabase-js
 * é de uso único: cada página precisa de um builder novo.
 */
type Pagina<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

const TAMANHO = 1000;

export async function fetchAll<T>(
  montar: () => { range: (de: number, ate: number) => Pagina<T> },
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const tudo: T[] = [];
  for (let de = 0; ; de += TAMANHO) {
    const { data, error } = await montar().range(de, de + TAMANHO - 1);
    // erro devolve no formato do supabase-js: quem chama já trata `{ data, error }`
    if (error) return { data: null, error };
    const linhas = data ?? [];
    tudo.push(...linhas);
    // página incompleta = acabou. Página cheia pode ter mais, então segue.
    if (linhas.length < TAMANHO) return { data: tudo, error: null };
  }
}

/**
 * Roda uma consulta com `.in()` em lotes e junta as respostas.
 *
 * A lista do `.in()` vai inteira na URL, e o gateway do Supabase recusa a
 * requisição quando ela fica grande: medido em 12/11/2026, 600 uuids (23 mil
 * caracteres) passam e 800 voltam 400. Uma lista tirada da empresa inteira,
 * desligados incluídos, já passa disso. Lote de 200 fica longe do limite.
 *
 * Cada lote ainda está sujeito ao teto de 1000 linhas. Se a consulta pode
 * devolver várias linhas por id, a fábrica usa `fetchAll` por dentro.
 *
 * Lista vazia não faz requisição nenhuma e devolve `[]`.
 */
export async function emLotes<T>(
  ids: readonly string[],
  ler: (lote: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  tamanho = 200,
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const tudo: T[] = [];
  for (let i = 0; i < ids.length; i += tamanho) {
    const { data, error } = await ler(ids.slice(i, i + tamanho));
    if (error) return { data: null, error };
    tudo.push(...(data ?? []));
  }
  return { data: tudo, error: null };
}
