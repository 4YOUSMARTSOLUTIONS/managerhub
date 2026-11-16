import { loadXlsx } from "@/lib/xlsx-lazy";

/**
 * O nome sempre termina em .xlsx. O `writeFile` da biblioteca escolhe o formato
 * pela extensão do nome, e sem ela o navegador salvava um arquivo sem tipo que
 * o Excel não abre (a exportação de Todas as previsões saía como "ferias").
 */
const comXlsx = (nome: string) => (/\.xlsx$/i.test(nome) ? nome : `${nome}.xlsx`);

export type OpcoesDaPlanilha = {
  /**
   * Cabeçalhos das colunas que trazem data `AAAA-MM-DD`: viram data de verdade
   * do Excel, exibida como DD/MM/AAAA (LUIZ, 16/11/2026). Texto "16/11/2026"
   * não serviria: o Excel não ordena nem filtra por data.
   */
  colunasDeData?: string[];
};

type Xlsx = Awaited<ReturnType<typeof loadXlsx>>;
type Planilha = ReturnType<Xlsx["utils"]["aoa_to_sheet"]>;

/**
 * Número de série do Excel calculado em UTC, de propósito: com `Date` local a
 * biblioteca aplica o fuso e a data pode sair um dia antes.
 */
const serialDoExcel = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return (Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
};

export function aplicarDatas(
  XLSX: Xlsx, ws: Planilha, headers: string[], rows: (string | number | null)[][], colunas: string[] | undefined,
) {
  if (!colunas?.length) return;
  const indices = colunas.map((c) => headers.indexOf(c)).filter((i) => i >= 0);
  rows.forEach((linha, r) => {
    for (const c of indices) {
      const v = linha[c];
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) continue;
      ws[XLSX.utils.encode_cell({ r: r + 1, c })] = { t: "n", v: serialDoExcel(v), z: "dd/mm/yyyy" };
    }
  });
}

/** Monta a pasta sem baixar: separado para dar para conferir o arquivo gerado. */
export async function montarPlanilha(
  sheetName: string,
  headers: string[],
  rows: (string | number | null)[][],
  opcoes?: OpcoesDaPlanilha,
) {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows.map((r) => r.map((c) => (c == null ? "" : c)))]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(12, Math.min(48, h.length + 6)) }));
  aplicarDatas(XLSX, ws, headers, rows, opcoes?.colunasDeData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return { XLSX, wb };
}

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
  opcoes?: OpcoesDaPlanilha,
) {
  const { XLSX, wb } = await montarPlanilha(sheetName, headers, rows, opcoes);
  XLSX.writeFile(wb, comXlsx(filename), { bookType: "xlsx" });
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
  XLSX.writeFile(wb, comXlsx(filename), { bookType: "xlsx" });
}
