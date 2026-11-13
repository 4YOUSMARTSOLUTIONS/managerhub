/**
 * O que vale em cada dia da agenda (LUIZ, 13/11/2026).
 *
 * A aderência, a carga do dia e Tempos e movimentos olham cada dia com a agenda
 * COMO ELA ERA naquele dia, e não como está hoje. Sem isso, acrescentar uma
 * tarefa hoje cobrava a tarefa em todos os dias passados, mudar os dias de uma
 * tarefa reescrevia o histórico e inativar a agenda sumia com o passado dela.
 *
 * - tarefa: `vigenteDe` (incluso) e `vigenteAte` (exclusivo, null = em vigor),
 *   gravados por `agenda_salvar_tarefas` com a data "Alterações valem a partir de";
 * - agenda: `periodosInativa`, mantidos pelo gatilho do banco ao inativar e reativar.
 */
import type { AgendaFull, AgendaTaskFull } from "@/lib/agenda-types";

/** A tarefa vale neste dia (YYYY-MM-DD)? */
export function tarefaVigenteEm(t: Pick<AgendaTaskFull, "active" | "vigenteDe" | "vigenteAte">, ds: string): boolean {
  return t.active && t.vigenteDe <= ds && (t.vigenteAte === null || ds < t.vigenteAte);
}

/** A agenda estava ativa neste dia (YYYY-MM-DD)? */
export function agendaAtivaEm(a: Pick<AgendaFull, "active" | "periodosInativa">, ds: string): boolean {
  const periodos = a.periodosInativa ?? [];
  if (periodos.some((p) => p.de <= ds && (p.ate === null || ds < p.ate))) return false;
  // inativa sem período registrado (não deveria existir depois de 13/11/2026): fora, como antes
  if (!a.active && periodos.length === 0) return false;
  return true;
}

/** As tarefas em vigor agora: as que o editor e a ficha da agenda mostram. */
export function tarefasAtuais<T extends Pick<AgendaTaskFull, "vigenteAte">>(a: { tasks: T[] }): T[] {
  return a.tasks.filter((t) => t.vigenteAte === null);
}
