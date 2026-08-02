"use client";

import { useState } from "react";
import { IconExport } from "@/components/ui/ImpExpIcons";
import { exportActions } from "@/lib/actions/actions";
import type { ActionFilters } from "./ActionsManager";

/** Baixa o .xlsx (base64) devolvido pelo servidor. */
function saveBase64(file: string, filename: string) {
  const bytes = Uint8Array.from(atob(file), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Exporta as ações respeitando os filtros aplicados, e não apenas a página exibida.
 * O arquivo é montado no servidor, então trafega pronto.
 */
export function ExportActionsButton({ filters, hasFilters }: { filters: ActionFilters; hasFilters: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true); setError("");
    const res = await exportActions({ ...filters }, null);
    setBusy(false);
    if (res.error || !res.file) { setError(res.error ?? "Não foi possível exportar."); return; }
    saveBase64(res.file, res.filename ?? "acoes.xlsx");
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={busy}
        title={hasFilters ? "Exporta as ações do filtro atual" : "Exporta todas as ações"}
        onClick={run}
      >
        <IconExport /> {busy ? "Exportando…" : "Exportar planilha"}
      </button>
      {error && <span className="badge badge-red" style={{ whiteSpace: "normal" }}>{error}</span>}
    </span>
  );
}
