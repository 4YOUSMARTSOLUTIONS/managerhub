"use client";

import { useState } from "react";
import { toast } from "sonner";
import { IconExport } from "@/components/ui/ImpExpIcons";
import { downloadSheet } from "@/lib/export-xlsx";
import { COLUNAS_PLANILHA_COLABORADORES } from "@/lib/planilha-colaboradores";
import { planilhaDaEquipe } from "@/lib/actions/equipe";

/**
 * Exporta a planilha de colaboradores da equipe (a cadeia de quem exporta), no
 * mesmo formato de Configurações > Colaboradores. Só exporta: importar é com o
 * DP. Os dados são buscados no clique, para o dado pessoal não viajar com a
 * página.
 */
export function ExportarEquipeButton() {
  const [gerando, setGerando] = useState(false);

  async function exportar() {
    setGerando(true);
    try {
      const r = await planilhaDaEquipe();
      if (r.error !== undefined) { toast.error(r.error); return; }
      if (r.linhas.length === 0) { toast.info("Ninguém na sua equipe para exportar."); return; }
      await downloadSheet("minha_equipe.xlsx", "Colaboradores", COLUNAS_PLANILHA_COLABORADORES, r.linhas);
    } finally {
      setGerando(false);
    }
  }

  return (
    <button type="button" className="btn btn-ghost btn-sm" disabled={gerando} onClick={exportar}>
      <IconExport /> {gerando ? "Gerando..." : "Exportar planilha"}
    </button>
  );
}
