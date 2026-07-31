import type { Enums } from "@/types/database";
import { farolAttainment } from "@/lib/goals-farol";

export type PnrTier = "total" | "alta" | "baixa" | "zero" | "pendente";

export type PnrKpiScoring = {
  direction: Enums<"goal_direction">;
  maxPoints: number;
  target: number | null;
  partialHigh: number | null; // fração de atingimento (ex.: 0,98 = 98%)
  partialLow: number | null;
  pointsHigh: number | null;
  pointsLow: number | null;
};

/**
 * Calcula a pontuação real de um KPI do PNR a partir do valor realizado.
 * Atingiu a meta cheia → pontuação total; senão, conforme o atingimento
 * alcance a parcial alta/baixa → pontos da respectiva parcial; senão 0.
 */
export function pnrScore(kpi: PnrKpiScoring, actual: number | null | undefined): {
  points: number | null;
  pct: number | null;
  tier: PnrTier;
} {
  if (actual == null) return { points: null, pct: null, tier: "pendente" };
  const target = kpi.target ?? 0;
  const { pct } = farolAttainment(kpi.direction, target, actual);
  const frac = pct == null ? 0 : pct / 100;

  const meets = kpi.direction === "menor_melhor" ? actual <= target : actual >= target;
  if (meets) return { points: kpi.maxPoints, pct, tier: "total" };
  if (kpi.partialHigh != null && kpi.pointsHigh != null && frac >= kpi.partialHigh) {
    return { points: kpi.pointsHigh, pct, tier: "alta" };
  }
  if (kpi.partialLow != null && kpi.pointsLow != null && frac >= kpi.partialLow) {
    return { points: kpi.pointsLow, pct, tier: "baixa" };
  }
  return { points: 0, pct, tier: "zero" };
}
