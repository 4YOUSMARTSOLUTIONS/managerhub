import { loadXlsx } from "@/lib/xlsx-lazy";

/**
 * Gera e baixa um .xlsx a partir de cabeçalhos + linhas.
 *
 * A biblioteca só é buscada aqui dentro, no clique: antes ela vinha no pacote de
 * toda tela que tem botão de exportar, mesmo para quem nunca exporta.
 */
export async function downloadSheet(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: (string | number | null)[][],
) {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows.map((r) => r.map((c) => (c == null ? "" : c)))]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(12, Math.min(48, h.length + 6)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

/** O mesmo, com várias abas no mesmo arquivo (ex.: detalhe + resumo). */
export async function downloadSheets(
  filename: string,
  sheets: { name: string; headers: string[]; rows: (string | number | null)[][] }[],
) {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([s.headers, ...s.rows.map((r) => r.map((c) => (c == null ? "" : c)))]);
    ws["!cols"] = s.headers.map((h) => ({ wch: Math.max(12, Math.min(48, h.length + 6)) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}
