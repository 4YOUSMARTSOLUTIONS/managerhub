/**
 * De quem era a agenda num dia (transferência com data, 11/11/2026).
 *
 * A agenda é da função e passa para quem assume a função. O banco guarda os
 * períodos de cada responsável (`agenda_responsaveis`, `de` incluso e `ate`
 * exclusivo), e diário, aderência, histórico e Tempos e movimentos atribuem
 * cada dia a quem era o responsável NAQUELE dia, e não a quem é agora. Sem
 * isso, transferir a agenda tiraria o passado de quem saiu e daria a quem
 * entrou dias que ele não trabalhou.
 */
import type { AgendaFull, AgendaResponsavel } from "@/lib/agenda-types";

type ComPeriodos = Pick<AgendaFull, "responsibleId" | "responsaveis">;

/** O responsável no dia `ds` (YYYY-MM-DD). */
export function responsavelEm(a: ComPeriodos, ds: string): string {
  const periodos = a.responsaveis;
  if (!periodos || periodos.length === 0) return a.responsibleId;
  for (const p of periodos) {
    if (p.de <= ds && (p.ate === null || ds < p.ate)) return p.userId;
  }
  // antes do primeiro período (demanda não prevista datada antes de a agenda
  // nascer): vale quem começou a agenda
  const primeiro = periodos.reduce((x, y) => (y.de < x.de ? y : x));
  return ds < primeiro.de ? primeiro.userId : a.responsibleId;
}

/** O período em vigor (sem fim), se houver. */
export function periodoAtual(a: ComPeriodos): AgendaResponsavel | null {
  return a.responsaveis?.find((p) => p.ate === null) ?? null;
}

/** Todos que já foram responsáveis pela agenda, incluindo o de agora. */
export function responsaveisDaAgenda(a: ComPeriodos): string[] {
  const s = new Set<string>([a.responsibleId]);
  for (const p of a.responsaveis ?? []) s.add(p.userId);
  return [...s];
}
