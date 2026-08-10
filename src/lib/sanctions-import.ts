/**
 * Leitura das colunas da planilha de punições.
 *
 * Mora fora do diálogo E fora da action pelo mesmo motivo de
 * `absences-import.ts`: as duas pontas precisam concordar. O diálogo mostra
 * "3 linhas inválidas" antes de gravar e o servidor decide o que entra; se cada
 * lado interpretasse "Advertência Verbal" do seu jeito, a prévia mentiria.
 *
 * A data e o nome são lidos pelas MESMAS funções da planilha de férias, e não
 * por cópias: `parseDataPlanilha` já recusa 31/02 e nunca troca dia com mês.
 */

import { normTexto, parseDataPlanilha } from "@/lib/absences-import";

export { normTexto, parseDataPlanilha };

/** uma linha da planilha, já lida e antes de qualquer validação de cadastro */
export type SanctionImportRow = {
  name: string;
  /** matrícula do colaborador (coluna ID do modelo); quando presente, decide */
  code?: string;
  /** o nome do tipo como veio escrito, para o erro poder citá-lo */
  type: string;
  /** `YYYY-MM-DD`, ou "" se a célula não deu para entender */
  occurredOn: string;
  note: string;
};

export type SanctionImportResult = {
  imported: number;
  /** mesma pessoa, mesmo tipo, mesma data: a observação é reescrita no lugar */
  updated: number;
  /** sem nome, sem data, ou data ilegível */
  invalid: number;
  notFound: number;
  /** matrícula e nome apontam para pessoas diferentes */
  mismatch: number;
  /** o tipo escrito não existe no catálogo da empresa */
  unknownType: number;
  error?: string;
};

/**
 * Acha o tipo no catálogo da empresa, ou devolve `null`.
 *
 * O casamento é por nome normalizado e EXATO, ao contrário do tipo de ausência,
 * que casa por trecho. Aqui o catálogo é livre: uma empresa pode ter
 * "Advertência" e "Advertência escrita" ao mesmo tempo, e casar por trecho
 * jogaria uma na outra em silêncio.
 *
 * Tipo desconhecido NÃO é criado na hora. Seria a forma mais rápida de encher o
 * catálogo com "Advertencia" e "Advertência" como coisas diferentes, e cada uma
 * com o seu redutor.
 */
export function acharTipo(
  escrito: string,
  catalogo: { id: string; name: string; active: boolean }[],
): { id: string; name: string } | null {
  const alvo = normTexto(escrito ?? "");
  if (!alvo) return null;
  // ativo primeiro: se um tipo foi desativado e outro nasceu com o mesmo nome,
  // a planilha nova aponta para o que está em uso
  const achado =
    catalogo.find((t) => t.active && normTexto(t.name) === alvo) ??
    catalogo.find((t) => normTexto(t.name) === alvo);
  return achado ? { id: achado.id, name: achado.name } : null;
}

/** A identidade de uma punição para efeito de reimportação. */
export const chaveDaPunicao = (userId: string, typeId: string, data: string) =>
  `${userId}|${typeId}|${data}`;
