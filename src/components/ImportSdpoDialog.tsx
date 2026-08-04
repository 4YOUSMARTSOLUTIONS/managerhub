"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { loadXlsx } from "@/lib/xlsx-lazy";
import { importSdpo, type SdpoImportRow, type SdpoImportResult } from "@/lib/actions/sdpo";
import { IconImport } from "@/components/ui/ImpExpIcons";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export function ImportSdpoDialog({ open: openProp, onClose, hideTrigger }: { open?: boolean; onClose?: () => void; hideTrigger?: boolean } = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const [rows, setRows] = useState<SdpoImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<SdpoImportResult | null>(null);
  const router = useRouter();

  function reset() { setRows([]); setFileName(""); setParseError(""); setSummary(null); }
  function close() { if (controlled) onClose?.(); else setInternalOpen(false); reset(); }

  async function downloadTemplate() {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Programa", "Pilar", "Seção", "Código Bloco", "Bloco", "Código Item", "Item"],
      ["SPO", "Comercial", "Gestão de Processos", "", "", "1.0", "Visitação GV na Base Foco"],
      ["SPO", "Comercial", "Gestão de Processos", "", "", "2.0", "Cobertura da carteira"],
      ["DPO", "Planejamento", "Fundamentos", "1.0", "Planejamento e gerenciamento de risco", "1.1", "Processo orçamentário, criação e LE"],
      ["DPO", "Planejamento", "Fundamentos", "1.0", "Planejamento e gerenciamento de risco", "1.2", "Análise de cenários"],
    ]);
    ws["!cols"] = [{ wch: 12 }, { wch: 18 }, { wch: 22 }, { wch: 13 }, { wch: 34 }, { wch: 12 }, { wch: 34 }];
    const wsI = XLSX.utils.aoa_to_sheet([
      ["Coluna", "Como preencher"],
      ["Programa", "Nome do programa (obrigatório), ex.: SPO, DPO. Repita nas linhas do mesmo programa."],
      ["Pilar", "Nome do pilar, dentro do programa. Opcional (vazio cadastra só o programa)."],
      ["Seção", "Nome da seção, dentro do pilar. Opcional (vazio cadastra só até o pilar)."],
      ["Código Bloco", "Código do bloco, ex.: 1.0. Opcional."],
      ["Bloco", "Opcional. No SPO deixe vazio (item fica direto na seção). No DPO informe o bloco."],
      ["Código Item", "Código do item, ex.: 1.1. Opcional."],
      ["Item", "Nome do item, dentro da seção (ou do bloco, se houver). Opcional."],
      ["Como funciona", "Cada linha é Programa > Pilar > Seção > [Bloco] > Item. O que já existe (mesmo nome) é reaproveitado; o novo é criado."],
    ]);
    wsI["!cols"] = [{ wch: 16 }, { wch: 92 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Estrutura");
    XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
    XLSX.writeFile(wb, "modelo_sdpo_estrutura.xlsx");
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
        programa: find("programa"),
        pilar: find("pilar"),
        secao: find("secao", "seção", "secção"),
        codeBloco: find("cod. bloco", "cod bloco", "codigo bloco", "código bloco"),
        bloco: find("bloco"),
        codeItem: find("cod. item", "cod item", "codigo item", "código item"),
        item: find("item"),
      };
      // "cód. bloco/item" contêm "bloco/item"; garante que as colunas de nome não peguem a de código
      if (idx.bloco === idx.codeBloco && idx.bloco !== -1) idx.bloco = headers.findIndex((h, k) => k !== idx.codeBloco && h.includes("bloco"));
      if (idx.item === idx.codeItem && idx.item !== -1) idx.item = headers.findIndex((h, k) => k !== idx.codeItem && h.includes("item"));
      if (idx.programa === -1) { setParseError("Não encontrei a coluna 'Programa'. Baixe o modelo."); return; }

      const str = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
      const parsed: SdpoImportRow[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i] as unknown[];
        const programa = str(r, idx.programa);
        const pilar = str(r, idx.pilar);
        const secao = str(r, idx.secao);
        const bloco = str(r, idx.bloco);
        const codeBloco = str(r, idx.codeBloco);
        const item = str(r, idx.item);
        const codeItem = str(r, idx.codeItem);
        if (!programa && !pilar && !secao && !bloco && !item) continue;
        parsed.push({ programa, pilar, secao, bloco, codeBloco, item, codeItem });
      }
      if (parsed.length === 0) { setParseError("Nenhuma linha com programa encontrada."); return; }
      setRows(parsed); setFileName(file.name);
    } catch (e) {
      setParseError("Não consegui ler o arquivo: " + (e as Error).message);
    }
  }

  async function doImport() {
    setImporting(true);
    const res = await importSdpo(rows);
    setImporting(false);
    if (res.error) { setSummary(res); return; }
    const parts = [
      `${res.programasCreated} programa(s)`,
      `${res.pilaresCreated} pilar(es)`,
      `${res.secoesCreated} seção(ões)`,
      `${res.blocosCreated} bloco(s)`,
      `${res.itensCreated} item(ns)`,
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
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Importar estrutura do Programa de Excelência (.xlsx)</h2>
              <button type="button" onClick={close} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
            </div>

            <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
                Cada linha é um caminho Programa, Pilar, Seção, [Bloco] e Item. Nomes já cadastrados são reaproveitados (sem duplicar); os novos são criados. O Bloco é opcional (SPO deixa vazio; DPO informa). Deixe os níveis à direita em branco para cadastrar só até aquele nível.
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
                      <span className="badge badge-green">{summary.programasCreated} programa(s)</span>
                      <span className="badge badge-green">{summary.pilaresCreated} pilar(es)</span>
                      <span className="badge badge-green">{summary.secoesCreated} seção(ões)</span>
                      <span className="badge badge-green">{summary.blocosCreated} bloco(s)</span>
                      <span className="badge badge-green">{summary.itensCreated} item(ns)</span>
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
