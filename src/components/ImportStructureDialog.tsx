"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { loadXlsx } from "@/lib/xlsx-lazy";
import { importStructure, type StructureImportRow, type StructureImportResult } from "@/lib/actions/registry";
import { IconImport } from "@/components/ui/ImpExpIcons";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export function ImportStructureDialog({ open: openProp, onClose, hideTrigger }: { open?: boolean; onClose?: () => void; hideTrigger?: boolean } = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const [rows, setRows] = useState<StructureImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<StructureImportResult | null>(null);
  const router = useRouter();

  function reset() { setRows([]); setFileName(""); setParseError(""); setSummary(null); }
  function close() { if (controlled) onClose?.(); else setInternalOpen(false); reset(); }

  async function downloadTemplate() {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Setor", "Subsetor", "Função"],
      ["Distribuição", "Logística", "Motorista"],
      ["Distribuição", "Logística", "Ajudante"],
      ["Distribuição", "Armazém", "Operador de empilhadeira"],
      ["Administrativo", "", "Analista financeiro"],
    ]);
    ws["!cols"] = [{ wch: 26 }, { wch: 26 }, { wch: 30 }];
    const wsI = XLSX.utils.aoa_to_sheet([
      ["Coluna", "Como preencher"],
      ["Setor", "Nome do setor. Repita nas linhas dos subsetores do mesmo setor. Criado se ainda não existir."],
      ["Subsetor", "Nome do subsetor, dentro do setor da linha. Opcional."],
      ["Função", "Nome da função. É uma lista independente (não fica ligada ao setor da linha). Opcional."],
      ["Como funciona", "O que já existe (mesmo nome) é reaproveitado, sem duplicar. O que é novo é criado."],
    ]);
    wsI["!cols"] = [{ wch: 16 }, { wch: 90 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Estrutura");
    XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
    XLSX.writeFile(wb, "modelo_setores_subsetores_funcoes.xlsx");
  }

  async function onFile(file: File) {
    const XLSX = await loadXlsx();
    setParseError(""); setSummary(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false });
      if (aoa.length < 2) { setParseError("Planilha vazia."); return; }

      const headers = (aoa[0] as unknown[]).map((h) => norm(String(h ?? "")));
      const find = (...keys: string[]) => headers.findIndex((h) => keys.some((k) => h.includes(k)));
      const idx = {
        setor: find("setor"),
        subsetor: find("subsetor", "sub setor", "sub-setor"),
        funcao: find("funcao", "função", "cargo"),
      };
      // "subsetor" contém "setor"; garante que a coluna Setor não seja a de Subsetor
      if (idx.setor === idx.subsetor && idx.subsetor !== -1) {
        idx.setor = headers.findIndex((h, i) => i !== idx.subsetor && h.includes("setor"));
      }
      if (idx.setor === -1 && idx.subsetor === -1 && idx.funcao === -1) {
        setParseError("Não encontrei as colunas Setor, Subsetor ou Função. Baixe o modelo.");
        return;
      }

      const str = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
      const parsed: StructureImportRow[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i] as unknown[];
        const setor = str(r, idx.setor);
        const subsetor = str(r, idx.subsetor);
        const funcao = str(r, idx.funcao);
        if (!setor && !subsetor && !funcao) continue;
        parsed.push({ setor, subsetor, funcao });
      }
      if (parsed.length === 0) { setParseError("Nenhuma linha preenchida encontrada."); return; }
      setRows(parsed); setFileName(file.name);
    } catch (e) {
      setParseError("Não consegui ler o arquivo: " + (e as Error).message);
    }
  }

  async function doImport() {
    setImporting(true);
    const res = await importStructure(rows);
    setImporting(false);
    if (res.error) { setSummary(res); return; }
    const parts = [
      `${res.setoresCreated} setor(es)`,
      `${res.subsetoresCreated} subsetor(es)`,
      `${res.funcoesCreated} função(ões)`,
    ];
    if (res.skipped > 0) parts.push(`${res.skipped} ignorada(s)`);
    toast.success(`Importação concluída: ${parts.join(", ")}.`);
    router.refresh();
    close();
  }

  return (
    <>
      {!hideTrigger && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInternalOpen(true)}><IconImport /> Importar em lote</button>}
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
          <div className="card" style={{ width: "100%", maxWidth: 560, boxShadow: "var(--mh-shadow-e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Importar Subsetores e Funções (.xlsx)</h2>
              <button type="button" onClick={close} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
            </div>

            <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
                Setor e Subsetor formam a hierarquia (o subsetor pertence ao setor da linha; o setor é criado se não existir). Função é uma lista independente. Nomes já cadastrados são reaproveitados, sem duplicar.
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
                  <div className="muted" style={{ marginTop: 4 }}>{rows.length} linha(s) para importar</div>
                </div>
              )}

              {summary && (
                <div className="card card-pad" style={{ fontSize: "0.9rem" }}>
                  {summary.error ? (
                    <span className="badge badge-red">{summary.error}</span>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                      <span className="badge badge-green">{summary.setoresCreated} setor(es)</span>
                      <span className="badge badge-green">{summary.subsetoresCreated} subsetor(es)</span>
                      <span className="badge badge-green">{summary.funcoesCreated} função(ões)</span>
                      {summary.skipped > 0 && <span className="badge badge-amber">{summary.skipped} linha(s) ignorada(s)</span>}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
              <button type="button" className="btn btn-ghost" onClick={close}>{summary && !summary.error ? "Fechar" : "Cancelar"}</button>
              <button type="button" className="btn btn-primary" disabled={!rows.length || importing || (!!summary && !summary.error)} onClick={doImport}>
                {importing ? "Importando…" : "Importar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
