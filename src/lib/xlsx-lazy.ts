/**
 * O `xlsx` sozinho pesa cerca de 880 KB e estava importado de forma estática em 14
 * módulos de cliente. Resultado: toda tela que tivesse um botão de exportar ou um
 * diálogo de importação carregava a biblioteca inteira no primeiro acesso, mesmo
 * para quem nunca clica em exportar.
 *
 * Aqui ele só é buscado quando alguém realmente vai ler ou gerar uma planilha, e
 * fica em cache no módulo: a segunda chamada não paga rede de novo.
 */
export type Xlsx = typeof import("xlsx");

let cache: Xlsx | null = null;

export async function loadXlsx(): Promise<Xlsx> {
  if (!cache) cache = await import("xlsx");
  return cache;
}
