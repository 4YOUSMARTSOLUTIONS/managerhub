"use client";

import { useState } from "react";
import { IconExport } from "@/components/ui/ImpExpIcons";
import { downloadSheet, type OpcoesDaPlanilha } from "@/lib/export-xlsx";

/** Botão de exportação em .xlsx dos dados já cadastrados (colunas espelham o modelo de importação). */
export function ExportButton({
  filename,
  sheetName = "Dados",
  headers,
  rows,
  label = "Exportar planilha",
  small = true,
  colunasDeData,
}: {
  filename: string;
  sheetName?: string;
  headers: string[];
  rows: (string | number | null)[][];
  label?: string;
  small?: boolean;
  /** colunas com data AAAA-MM-DD que saem como data DD/MM/AAAA (ver OpcoesDaPlanilha) */
  colunasDeData?: OpcoesDaPlanilha["colunasDeData"];
}) {
  const empty = rows.length === 0;
  // a geração da planilha virou assíncrona (a lib só é buscada no clique), então
  // o botão trava enquanto isso para não disparar dois downloads
  const [gerando, setGerando] = useState(false);
  async function exportar() {
    setGerando(true);
    try {
      await downloadSheet(filename, sheetName, headers, rows, { colunasDeData });
    } finally {
      setGerando(false);
    }
  }
  return (
    <button
      type="button"
      className={`btn btn-ghost ${small ? "btn-sm" : ""}`}
      disabled={empty || gerando}
      title={empty ? "Nada cadastrado para exportar" : ""}
      onClick={exportar}
    >
      <IconExport /> {gerando ? "Gerando..." : label}
    </button>
  );
}
