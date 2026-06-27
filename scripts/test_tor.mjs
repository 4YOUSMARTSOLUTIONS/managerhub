import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync } from "node:fs";

// ---- extração de itens com posição ----
async function extractItems(path) {
  const data = new Uint8Array(readFileSync(path));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const items = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for (const i of tc.items) {
      if (!i.str.trim()) continue;
      items.push({ str: i.str.trim(), x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) });
    }
  }
  return items;
}

// ---- parser TOR (lógica que será portada para tor-parser.ts) ----
const LABELS = {
  objetivo: "objetivo",
  dono: "owner",
  participantes: "participantsText",
  local: "locationText",
  "duração": "durationRaw",
  duracao: "durationRaw",
  "frequência": "frequencyRaw",
  frequencia: "frequencyRaw",
};
const PERIOD_MAP = {
  diaria: "diaria", diária: "diaria", diario: "diaria", diário: "diaria",
  semanal: "semanal",
  quinzenal: "quinzenal",
  mensal: "mensal",
  bimestral: "bimestral",
  trimestral: "trimestral",
  semestral: "semestral",
  anual: "anual",
  "sob demanda": "sob_demanda",
};
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.:]/g, "").trim();

function parseTor(items) {
  const out = { content: [], generalRules: [], howTo: [] };

  // 0) título: item mais ao topo, ignorando "Voltar"
  const titleCand = items.filter((it) => norm(it.str) !== "voltar").sort((a, b) => b.y - a.y)[0];
  if (titleCand && titleCand.str.length <= 60) out.name = titleCand.str;

  // 1) campos escalares: rótulo na esquerda (x<95), valor na mesma linha em x>=95
  const labelHits = {}; // field -> {y}
  for (const it of items) {
    const key = norm(it.str);
    if (it.x < 95 && LABELS[key]) labelHits[LABELS[key]] = it.y;
  }
  const valueAt = (y) => {
    const cands = items.filter((it) => it.x >= 95 && it.x < 400 && Math.abs(it.y - y) <= 3);
    cands.sort((a, b) => a.x - b.x);
    return cands.map((c) => c.str).join(" ").trim();
  };
  for (const [field, y] of Object.entries(labelHits)) {
    const v = valueAt(y);
    if (v) out[field] = v;
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
  for (const t of tempoRows) {
    const dono = items.find((it) => it.x >= 455 && Math.abs(it.y - t.y) <= 4);
    const texts = items
      .filter((it) => it.x >= 112 && it.x < 405 && Math.abs(it.y - t.y) <= 8)
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const item = texts.map((x) => x.str).join(" ").trim();
    if (item) out.content.push({ item, tempo: t.str, dono: dono?.str ?? "", _y: t.y });
  }
  out.content.sort((a, b) => b._y - a._y).forEach((c) => delete c._y);

  // 3) listas numeradas (sem coluna de tempo): número em x∈[98,112], texto em x∈[113,400]
  const numItems = items
    .filter((it) => it.x >= 98 && it.x <= 113 && /^\d+\.?$/.test(it.str))
    .filter((it) => !tempoRows.some((t) => Math.abs(t.y - it.y) <= 4)) // exclui linhas da tabela
    .sort((a, b) => b.y - a.y);

  // piso: linhas de regra ficam acima da tabela de conteúdo
  const floorY = tempoRows.length ? Math.max(...tempoRows.map((t) => t.y)) + 4 : -Infinity;

  const ruleEntries = numItems.map((n, i) => {
    const num = parseInt(n.str, 10);
    const upperY = n.y + 3;
    const lowerY = Math.max((numItems[i + 1]?.y ?? -Infinity) + 4, floorY);
    const texts = items
      .filter((it) => it.x >= 113 && it.x < 400 && it.y <= upperY && it.y > lowerY)
      .filter((it) => !tempoRows.some((t) => Math.abs(t.y - it.y) <= 4))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    return { num, y: n.y, text: texts.map((t) => t.str).join(" ").trim() };
  }).filter((e) => e.text);

  // separa em duas listas pelo reinício da numeração
  const lists = [];
  let cur = [];
  for (const e of ruleEntries) {
    if (e.num === 1 && cur.length) { lists.push(cur); cur = []; }
    cur.push(e);
  }
  if (cur.length) lists.push(cur);

  // rótulos das seções
  const findLabelY = (names) => {
    const hit = items.find((it) => it.x < 95 && names.includes(norm(it.str)));
    return hit?.y ?? null;
  };
  const regrasY = findLabelY(["regras gerais"]);
  const comoY = findLabelY(["como realizar"]);

  const centroid = (l) => l.reduce((s, e) => s + e.y, 0) / l.length;
  const assign = (l) => {
    const c = centroid(l);
    if (regrasY != null && comoY != null)
      return Math.abs(c - regrasY) <= Math.abs(c - comoY) ? "generalRules" : "howTo";
    return "generalRules";
  };
  for (const l of lists) out[assign(l)].push(...l.map((e) => e.text));

  return out;
}

// ---- run ----
const path = process.argv[2] ?? "C:/Users/luiz.nobre/Downloads/TOR.pdf";
const items = await extractItems(path);
const parsed = parseTor(items);
console.log(JSON.stringify(parsed, null, 2));
