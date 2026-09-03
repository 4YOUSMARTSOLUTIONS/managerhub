import type { Enums } from "@/types/database";

export type FarolStatus = "atingida" | "parcial" | "nao_atingida" | "pendente";

/**
 * Calcula o atingimento (%) e o status do farol de uma meta no período.
 * - maior_melhor: quanto maior o realizado em relação à meta, melhor.
 * - menor_melhor: quanto menor o realizado em relação à meta, melhor.
 * Sem realizado (null) → "pendente".
 * `partial` é um limiar mais frouxo que a meta: se o realizado não bate a meta
 * mas alcança o parcial, o status é "parcial".
 */
export function farolAttainment(
  direction: Enums<"goal_direction">,
  target: number,
  actual: number | null | undefined,
  partial?: number | null,
): { pct: number | null; status: FarolStatus } {
  if (actual == null) return { pct: null, status: "pendente" };

  let pct: number;
  if (direction === "menor_melhor") {
    pct = actual > 0 ? (target / actual) * 100 : 100;
  } else {
    pct = target > 0 ? (actual / target) * 100 : actual > 0 ? 100 : 0;
  }
  pct = Math.round(pct);

  // atingiu a meta cheia?
  const meets = direction === "menor_melhor" ? actual <= target : actual >= target;
  // atingiu ao menos o limiar parcial (mais frouxo)?
  const meetsPartial =
    partial != null && (direction === "menor_melhor" ? actual <= partial : actual >= partial);

  const status: FarolStatus = meets ? "atingida" : meetsPartial ? "parcial" : "nao_atingida";
  return { pct, status };
}

/** Crédito de atingimento (0..1): atingida = 1, parcial = partialPct/100, senão 0. */
export function attainmentCredit(status: FarolStatus, partialPct: number): number {
  if (status === "atingida") return 1;
  if (status === "parcial") return Math.max(0, Math.min(100, partialPct)) / 100;
  return 0;
}

/**
 * A evidência é prova de resultado, então só é cobrada de quem reivindica um.
 *
 * Meta não atingida não tem o que comprovar: ninguém forja um fracasso, e pedir
 * anexo ali só empurrava para a frente o lançamento do número ruim, que é
 * justamente o que precisa aparecer cedo. Parcial continua exigindo porque paga
 * RV, e pendente (sem realizado) nunca exigiu.
 */
export function exigeEvidencia(status: FarolStatus): boolean {
  return status === "atingida" || status === "parcial";
}
