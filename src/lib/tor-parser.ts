// Parser de TOR (Termos de Referência) a partir de itens de texto posicionados.
// Lógica validada contra o layout padrão (ver scripts/test_tor.mjs).

export type TextItem = { str: string; x: number; y: number };

export type ParsedTor = {
  name?: string;
  objetivo?: string;
  owner?: string;
  participantsText?: string;
  locationText?: string;
  durationValue?: number;
  durationUnit?: "min" | "h";
  periodicity?: string;
  content: { item: string; tempo: string; dono: string }[];
  generalRules: string[];
  howTo: string[];
};

const LABELS: Record<string, keyof ParsedTor | "durationRaw" | "frequencyRaw"> = {
  objetivo: "objetivo",
  dono: "owner",
  participantes: "participantsText",
  local: "locationText",
  duracao: "durationRaw",
  frequencia: "frequencyRaw",
};

const PERIOD_MAP: Record<string, string> = {
  diaria: "diaria",
  diario: "diaria",
  semanal: "semanal",
  quinzenal: "quinzenal",
  mensal: "mensal",
  bimestral: "bimestral",
  trimestral: "trimestral",
  semestral: "semestral",
  anual: "anual",
  "sob demanda": "sob_demanda",
};

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.:]/g, "").trim();

export function parseTor(items: TextItem[]): ParsedTor {
  const out: ParsedTor & { durationRaw?: string; frequencyRaw?: string } = {
    content: [],
    generalRules: [],
    howTo: [],
  };

  // 0) título da reunião: item mais ao topo (maior y), ignorando o botão "Voltar"
  const titleCand = items
    .filter((it) => norm(it.str) !== "voltar")
    .sort((a, b) => b.y - a.y)[0];
  if (titleCand && titleCand.str.length <= 60) out.name = titleCand.str;

  // 1) campos escalares: rótulo à esquerda (x<95), valor na mesma linha em x>=95
  const labelHits: Record<string, number> = {};
  for (const it of items) {
    const key = norm(it.str);
    if (it.x < 95 && LABELS[key]) labelHits[LABELS[key]] = it.y;
  }
  const valueAt = (y: number) =>
    items
      .filter((it) => it.x >= 95 && it.x < 400 && Math.abs(it.y - y) <= 3)
      .sort((a, b) => a.x - b.x)
      .map((c) => c.str)
      .join(" ")
      .trim();
  for (const [field, y] of Object.entries(labelHits)) {
    const v = valueAt(y);
    if (v) (out as Record<string, unknown>)[field] = v;
  }

  // duração -> valor + unidade
  if (out.durationRaw) {
    const m = out.durationRaw.match(/(\d+(?:[.,]\d+)?)\s*(h|hora|horas|min|minuto|minutos|m)\b/i);
    if (m) {
      out.durationValue = Number(m[1].replace(",", "."));
      out.durationUnit = /^h/i.test(m[2]) ? "h" : "min";
    }
    delete out.durationRaw;
  }
  // frequência -> periodicity
  if (out.frequencyRaw) {
    const n = norm(out.frequencyRaw);
    out.periodicity = PERIOD_MAP[n] ?? Object.entries(PERIOD_MAP).find(([k]) => n.includes(k))?.[1];
    delete out.frequencyRaw;
  }

  // 2) tabela de conteúdo: linhas com "tempo" em x∈[405,450]
  const tempoRows = items.filter((it) => it.x >= 405 && it.x <= 450 && /\d/.test(it.str));
  const contentRows: { item: string; tempo: string; dono: string; y: number }[] = [];
  for (const t of tempoRows) {
    const dono = items.find((it) => it.x >= 455 && Math.abs(it.y - t.y) <= 4);
    const texts = items
      .filter((it) => it.x >= 112 && it.x < 405 && Math.abs(it.y - t.y) <= 8)
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const item = texts.map((x) => x.str).join(" ").trim();
    if (item) contentRows.push({ item, tempo: t.str, dono: dono?.str ?? "", y: t.y });
  }
  out.content = contentRows.sort((a, b) => b.y - a.y).map(({ item, tempo, dono }) => ({ item, tempo, dono }));

  // 3) listas numeradas (sem coluna de tempo)
  const numItems = items
    .filter((it) => it.x >= 98 && it.x <= 113 && /^\d+\.?$/.test(it.str))
    .filter((it) => !tempoRows.some((t) => Math.abs(t.y - it.y) <= 4))
    .sort((a, b) => b.y - a.y);

  const floorY = tempoRows.length ? Math.max(...tempoRows.map((t) => t.y)) + 4 : -Infinity;

  const ruleEntries = numItems
    .map((n, i) => {
      const num = parseInt(n.str, 10);
      const upperY = n.y + 3;
      const lowerY = Math.max((numItems[i + 1]?.y ?? -Infinity) + 4, floorY);
      const texts = items
        .filter((it) => it.x >= 113 && it.x < 400 && it.y <= upperY && it.y > lowerY)
        .filter((it) => !tempoRows.some((t) => Math.abs(t.y - it.y) <= 4))
        .sort((a, b) => b.y - a.y || a.x - b.x);
      return { num, y: n.y, text: texts.map((t) => t.str).join(" ").trim() };
    })
    .filter((e) => e.text);

  // separa em listas pelo reinício da numeração
  const lists: { num: number; y: number; text: string }[][] = [];
  let cur: { num: number; y: number; text: string }[] = [];
  for (const e of ruleEntries) {
    if (e.num === 1 && cur.length) { lists.push(cur); cur = []; }
    cur.push(e);
  }
  if (cur.length) lists.push(cur);

  const findLabelY = (names: string[]) => items.find((it) => it.x < 95 && names.includes(norm(it.str)))?.y ?? null;
  const regrasY = findLabelY(["regras gerais"]);
  const comoY = findLabelY(["como realizar"]);
  const centroid = (l: { y: number }[]) => l.reduce((s, e) => s + e.y, 0) / l.length;
  const assign = (l: { y: number }[]): "generalRules" | "howTo" => {
    if (regrasY != null && comoY != null)
      return Math.abs(centroid(l) - regrasY) <= Math.abs(centroid(l) - comoY) ? "generalRules" : "howTo";
    return "generalRules";
  };
  for (const l of lists) out[assign(l)].push(...l.map((e) => e.text));

  delete out.durationRaw;
  delete out.frequencyRaw;
  return out;
}
