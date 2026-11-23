import type { EffStatus } from "@/lib/constants";

/**
 * Status com que a tela de Ações abre (LUIZ, 22/11/2026): o que ainda pede
 * alguém agir. Concluída e Cancelada ficam a um clique, no filtro de Status.
 *
 * Mora num módulo neutro pelo mesmo motivo de `acoes-minhas.ts`: a página
 * (Server Component) resolve o padrão e o componente (Client) escreve a URL.
 */
export const STATUS_PADRAO: EffStatus[] = ["atrasada", "andamento", "aguardando"];

/** sentinela de "todos": ausente na URL significa o padrão, então tirar o filtro precisa ser explícito */
export const STATUS_TODOS = "todos";

const STATUS_VALIDOS: readonly string[] = ["concluida", "cancelada", "aguardando", "atrasada", "andamento"];

/** o que a URL pediu, já validado. Ausente = padrão; sentinela ou lixo = todos. */
export function resolverStatus(naUrl: string[]): string[] {
  if (naUrl.length === 0) return STATUS_PADRAO;
  return naUrl.filter((v) => STATUS_VALIDOS.includes(v));
}
