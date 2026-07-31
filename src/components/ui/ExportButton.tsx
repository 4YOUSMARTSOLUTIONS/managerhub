"use client";

import { IconExport } from "@/components/ui/ImpExpIcons";
import { downloadSheet } from "@/lib/export-xlsx";

/** Botão de exportação em .xlsx dos dados já cadastrados (colunas espelham o modelo de importação). */
export function ExportButton({
  filename,
  sheetName = "Dados",
  headers,
  rows,
  label = "Exportar planilha",
  small = true,
}: {
  filename: string;
  sheetName?: string;
  headers: string[];
  rows: (string | number | null)[][];
  label?: string;
  small?: boolean;
}) {
  const empty = rows.length === 0;
  return (
    <button
      type="button"
      className={`btn btn-ghost ${small ? "btn-sm" : ""}`}
      disabled={empty}
      title={empty ? "Nada cadastrado para exportar" : ""}
      onClick={() => downloadSheet(filename, sheetName, headers, rows)}
    >
      <IconExport /> {label}
    </button>
  );
}
