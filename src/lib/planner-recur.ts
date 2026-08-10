/**
 * A conta de datas da recorrência do Planner.
 *
 * A recorrência não agenda nada: quando uma tarefa recorrente é CONCLUÍDA, a
 * server action clona a tarefa com as datas avançadas por esta função. Fica
 * fora da action para se conferir de mesa, sem navegador, e porque a mesma
 * conta serve a qualquer tela que queira prever "a próxima é dia tal".
 *
 * Tudo em texto `YYYY-MM-DD` e UTC ao meio-dia, como o resto do sistema: sem
 * `new Date(iso)` puro, que no fuso de Brasília faz o dia virar o anterior.
 */

import type { Enums } from "@/types/database";

export type PlannerRecurrence = Enums<"planner_recurrence">;

const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * A data seguinte de uma recorrência, ou `null` quando não há o que avançar
 * (`none`, ou data ilegível).
 *
 * Mensal usa CLAMP no fim do mês: 31/01 → 28/02 (29 em bissexto), e NÃO
 * "pula" para 03/03 como `setMonth` cru faria. É o comportamento que uma
 * pessoa espera de "todo dia 31": no mês curto, vale o último dia.
 */
export function proximaData(iso: string, recorrencia: PlannerRecurrence): string | null {
  if (recorrencia === "none") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [ano, mes, dia] = iso.split("-").map(Number);

  if (recorrencia === "daily" || recorrencia === "weekly") {
    const d = new Date(Date.UTC(ano, mes - 1, dia, 12));
    if (Number.isNaN(d.getTime())) return null;
    d.setUTCDate(d.getUTCDate() + (recorrencia === "daily" ? 1 : 7));
    return fmt(d);
  }

  // mensal: mês seguinte, mesmo dia, com clamp no último dia do mês destino
  const mesAlvo = mes === 12 ? 1 : mes + 1;
  const anoAlvo = mes === 12 ? ano + 1 : ano;
  const ultimoDoAlvo = new Date(Date.UTC(anoAlvo, mesAlvo, 0, 12)).getUTCDate();
  return `${anoAlvo}-${pad(mesAlvo)}-${pad(Math.min(dia, ultimoDoAlvo))}`;
}
