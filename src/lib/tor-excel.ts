// Parser de TOR a partir de uma planilha Excel no padrão SDPO.
// Recebe a matriz de células (linha x coluna) e produz o MESMO ParsedTor do
// parser de PDF, para reaproveitar todo o mapeamento do formulário.

import { norm, mapPeriodicity, parseDuration, type ParsedTor } from "./tor-parser";

type Cell = string | number | null | undefined;

/** Número de item de lista/pauta: "1", "1.", "1)" (célula só com o número). */
const isNumberCell = (s: string) => /^\d+[.)]?$/.test(s.trim());

/** Remove um prefixo "N." / "N)" quando o número vem colado ao texto. */
const stripNumberPrefix = (s: string) => s.replace(/^\s*\d+[.)]\s+/, "").trim();

export function parseTorRows(rows: Cell[][], sheetName: string): ParsedTor {
  const out: ParsedTor = { content: [], generalRules: [], howTo: [] };

  type Section = null | "rules" | "howto" | "content";
  let section: Section = null;

  const pushList = (target: string[], cells: string[]) => {
    if (!cells.length) return;
    // cells podem ser ["1.", "texto..."] ou ["1. texto..."] ou já só o texto
    if (isNumberCell(cells[0])) {
      const text = cells.slice(1).join(" ").trim();
      if (text) target.push(text);
    } else {
      const text = stripNumberPrefix(cells.join(" "));
      if (text) target.push(text);
    }
  };

  for (const rawRow of rows) {
    const cells = (rawRow ?? [])
      .map((c) => (c == null ? "" : String(c)).replace(/\s+/g, " ").trim())
      .filter((c) => c !== "");
    if (!cells.length) continue;

    const label = norm(cells[0]);
    const rest = cells.slice(1);

    // Nome: célula ao lado de "Voltar" (cabeçalho do template)
    if (label === "voltar") {
      const n = rest.join(" ").trim();
      if (n) out.name = n;
      section = null;
      continue;
    }

    // Campos escalares
    if (label === "objetivo") { out.objetivo = rest.join(" ").trim() || out.objetivo; section = null; continue; }
    if (label === "dono") { out.owner = rest.join(" ").trim() || out.owner; section = null; continue; }
    if (label === "participantes") { out.participantsText = rest.join(" ").trim() || out.participantsText; section = null; continue; }
    if (label === "local") { out.locationText = rest.join(" ").trim() || out.locationText; section = null; continue; }
    if (label === "duracao") {
      const d = parseDuration(rest.join(" "));
      if (d.value != null) { out.durationValue = d.value; out.durationUnit = d.unit; }
      section = null; continue;
    }
    if (label === "frequencia") { out.periodicity = mapPeriodicity(rest.join(" ")) ?? out.periodicity; section = null; continue; }

    // Seções de lista (o primeiro item pode vir na mesma linha do rótulo)
    if (label === "regras gerais") { section = "rules"; pushList(out.generalRules, rest); continue; }
    if (label === "como realizar") { section = "howto"; pushList(out.howTo, rest); continue; }

    // Cabeçalho da pauta: "Conteúdo | Tempo | Dono"
    if (label === "conteudo") { section = "content"; continue; }

    // Linhas dentro de uma seção
    if (section === "rules") { pushList(out.generalRules, cells); continue; }
    if (section === "howto") { pushList(out.howTo, cells); continue; }
    if (section === "content") {
      if (isNumberCell(cells[0])) {
        const c = cells.slice(1);
        out.content.push({ item: (c[0] ?? "").trim(), tempo: (c[1] ?? "").trim(), dono: c.slice(2).join(" ").trim() });
      } else {
        // linha de continuação: concatena no item anterior
        const last = out.content[out.content.length - 1];
        if (last) last.item = `${last.item} ${cells.join(" ")}`.trim();
      }
      continue;
    }
  }

  if (!out.name) out.name = sheetName?.trim() || undefined;
  return out;
}
