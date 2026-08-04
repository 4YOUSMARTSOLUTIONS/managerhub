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
