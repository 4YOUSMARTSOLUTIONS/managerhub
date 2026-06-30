import type { Enums } from "@/types/database";

export type FarolStatus = "atingida" | "nao_atingida" | "pendente";

/**
 * Calcula o atingimento (%) e o status do farol de uma meta no período.
 * - maior_melhor: quanto maior o realizado em relação à meta, melhor.
 * - menor_melhor: quanto menor o realizado em relação à meta, melhor.
 * Sem realizado (null) → "pendente".
 */
export function farolAttainment(
  direction: Enums<"goal_direction">,
  target: number,
  actual: number | null | undefined,
): { pct: number | null; status: FarolStatus } {
  if (actual == null) return { pct: null, status: "pendente" };

  let pct: number;
  if (direction === "menor_melhor") {
    pct = actual > 0 ? (target / actual) * 100 : 100;
  } else {
    pct = target > 0 ? (actual / target) * 100 : actual > 0 ? 100 : 0;
  }
  pct = Math.round(pct);

  const status: FarolStatus = pct >= 100 ? "atingida" : "nao_atingida";
  return { pct, status };
}
