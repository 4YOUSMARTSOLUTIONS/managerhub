export type NpsCategory = "promotor" | "neutro" | "detrator";

export function npsCategory(score: number): NpsCategory {
  if (score >= 9) return "promotor";
  if (score >= 7) return "neutro";
  return "detrator";
}

/** Cor por faixa da nota (0–6 vermelho, 7–8 âmbar, 9–10 verde). */
export function npsColor(score: number): string {
  if (score >= 9) return "#16a34a";
  if (score >= 7) return "#b45309";
  return "#dc2626";
}

/** Carinha por faixa da nota. */
export function npsFace(score: number): string {
  if (score >= 9) return "🙂";
  if (score >= 7) return "😐";
  return "🙁";
}

export type NpsResult = {
  nps: number; // -100..100
  media: number; // 0..10
  promotores: number;
  neutros: number;
  detratores: number;
  total: number;
};

export function computeNps(scores: number[]): NpsResult {
  const total = scores.length;
  if (total === 0) return { nps: 0, media: 0, promotores: 0, neutros: 0, detratores: 0, total: 0 };
  let promotores = 0, neutros = 0, detratores = 0, soma = 0;
  for (const s of scores) {
    soma += s;
    const c = npsCategory(s);
    if (c === "promotor") promotores += 1;
    else if (c === "neutro") neutros += 1;
    else detratores += 1;
  }
  const nps = Math.round(((promotores - detratores) / total) * 100);
  const media = Math.round((soma / total) * 10) / 10;
  return { nps, media, promotores, neutros, detratores, total };
}
