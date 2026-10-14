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
