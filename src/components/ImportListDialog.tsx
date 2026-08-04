"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { loadXlsx } from "@/lib/xlsx-lazy";
import type { SimpleImportResult } from "@/lib/actions/sdpo";
import { IconImport } from "@/components/ui/ImpExpIcons";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/**
 * Importa um catálogo simples (uma coluna de nomes) via Excel.
 * Usado para KPIs e Ferramentas de gestão, cada um com sua própria action.
 */
export function ImportListDialog({
  title,
  column,
  noun,
  examples,
  templateFile,
  findKeys,
  action,
  open: openProp,
  onClose,
  hideTrigger,
}: {
  title: string;
  column: string;              // cabeçalho da coluna no modelo (ex.: "KPI")
  noun: string;                // rótulo no resumo (ex.: "KPI(s)")
  examples: string[];          // linhas de exemplo do modelo
  templateFile: string;        // nome do arquivo do modelo
  findKeys: string[];          // palavras-chave para localizar a coluna
  action: (names: string[]) => Promise<SimpleImportResult>;
  open?: boolean;
  onClose?: () => void;
  hideTrigger?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const [names, setNames] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<SimpleImportResult | null>(null);
  const router = useRouter();

  function reset() { setNames([]); setFileName(""); setParseError(""); setSummary(null); }
  function close() { if (controlled) onClose?.(); else setInternalOpen(false); reset(); }

  async function downloadTemplate() {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.aoa_to_sheet([[column], ...examples.map((e) => [e])]);
    ws["!cols"] = [{ wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, column);
    XLSX.writeFile(wb, templateFile);
  }

  async function onFile(file: File) {
    const XLSX = await loadXlsx();
    setParseError(""); setSummary(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false });
      if (aoa.length < 1) { setParseError("Planilha vazia."); return; }

      const headers = (aoa[0] as unknown[]).map((h) => norm(String(h ?? "")));
      let col = headers.findIndex((h) => findKeys.some((k) => h.includes(k)));
      // sem cabeçalho reconhecido: assume a 1ª coluna e não pula a primeira linha
      const hasHeader = col !== -1;
      if (col === -1) col = 0;

      const list: string[] = [];
      for (let i = hasHeader ? 1 : 0; i < aoa.length; i++) {
        const v = String((aoa[i] as unknown[])[col] ?? "").trim();
        if (v) list.push(v);
      }
      if (list.length === 0) { setParseError("Nenhum nome encontrado na planilha."); return; }
      setNames(list); setFileName(file.name);
    } catch (e) {
      setParseError("Não consegui ler o arquivo: " + (e as Error).message);
    }
  }

  async function doImport() {
    setImporting(true);
    const res = await action(names);
    setImporting(false);
    if (res.error) { setSummary(res); return; }
    const parts = [`${res.created} criado(s)`];
    if (res.skipped > 0) parts.push(`${res.skipped} já existiam`);
    toast.success(`Importação concluída: ${parts.join(", ")}.`);
    router.refresh();
    close();
  }

  return (
    <>
      {!hideTrigger && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInternalOpen(true)}><IconImport /> Importar em lote</button>}
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
          <div className="card" style={{ width: "100%", maxWidth: 480, boxShadow: "var(--mh-shadow-e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{title}</h2>
              <button type="button" onClick={close} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
            </div>

            <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
                Planilha com uma coluna <strong>{column}</strong> (um nome por linha). Nomes já cadastrados são reaproveitados, sem duplicar.
              </p>
              <div><button type="button" className="btn btn-ghost btn-sm" onClick={downloadTemplate}>↓ Baixar modelo</button></div>
              <div>
                <label className="label">Arquivo</label>
                <input type="file" accept=".xlsx,.xls,.csv" className="input" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              </div>

              {parseError && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{parseError}</p>}

              {fileName && !summary && (
                <div className="card card-pad" style={{ fontSize: "0.88rem" }}>
                  <strong>{fileName}</strong>
                  <div className="muted" style={{ marginTop: 4 }}>{names.length} {noun} para importar</div>
                </div>
              )}

              {summary && (
                <div className="card card-pad" style={{ fontSize: "0.9rem" }}>
                  {summary.error ? (
                    <span className="badge badge-red">{summary.error}</span>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                      <span className="badge badge-green">{summary.created} criado(s)</span>
                      {summary.skipped > 0 && <span className="badge badge-amber">{summary.skipped} já existiam</span>}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
              <button type="button" className="btn btn-ghost" onClick={close}>Cancelar</button>
              <button type="button" className="btn btn-primary" disabled={!names.length || importing} onClick={doImport}>
                {importing ? "Importando…" : "Importar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
