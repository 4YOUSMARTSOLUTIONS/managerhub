"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loadXlsx } from "@/lib/xlsx-lazy";
import { importPnr, type PnrImportRow, type PnrImportResult } from "@/lib/actions/pnr";
import { IconImport } from "@/components/ui/ImpExpIcons";

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export function ImportPnrDialog({ open: openProp, onClose, hideTrigger }: { open?: boolean; onClose?: () => void; hideTrigger?: boolean } = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const [rows, setRows] = useState<PnrImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<PnrImportResult | null>(null);
  const router = useRouter();

  function reset() { setRows([]); setFileName(""); setParseError(""); setSummary(null); }
  function close() { if (controlled) onClose?.(); else setInternalOpen(false); reset(); }

  async function downloadTemplate() {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Ordem KPI", "KPI", "Conceito", "Pontuação total", "DONOS", "Un. Medida", "Meta", "Direção", "Meta Parcial Alta", "Meta Parcial Baixa", "Pontos Parcial Alta", "Pontos Parcial Baixa"],
      ["-", "I. ATENDIMENTO AO MERCADO", "", 150, "-", "-", "-", "", "-", "-", "-", "-"],
      [1, "TOOS Falta Teórica TT", "Faltas teóricas ÷ total de itens", 40, "João Silva", "%", 0.02, "menor é melhor", 0.98, 0.96, 36, 32],
      [2, "NPS PDV", "Nota de satisfação dos PDVs", 30, "João Silva", "%", 0.733, "maior é melhor", "-", "-", "-", "-"],
    ]);
    ws["!cols"] = [{ wch: 10 }, { wch: 34 }, { wch: 30 }, { wch: 14 }, { wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    const wsI = XLSX.utils.aoa_to_sheet([
      ["Coluna", "Como preencher"],
      ["Ordem KPI", "Número do KPI. Use \"-\" nas linhas de seção (ex.: I. Atendimento ao Mercado)"],
      ["KPI", "Nome do indicador; nas linhas de seção, o nome da seção"],
      ["Conceito", "Como o indicador é medido / o que significa (texto livre) — opcional"],
      ["Pontuação total", "Pontos máximos do KPI (ou o total da seção nas linhas de seção)"],
      ["DONOS", "Nome completo do responsável, como cadastrado. \"-\" nas seções"],
      ["Un. Medida", "%, Nº, R$…"],
      ["Meta", "Valor da meta (100%)"],
      ["Direção", "\"Maior é melhor\" ou \"Menor é melhor\""],
      ["Meta Parcial Alta / Baixa", "Fração do atingimento p/ ganhar a parcial (ex.: 0,98 = 98%). \"-\" quando não houver parcial"],
      ["Pontos Parcial Alta / Baixa", "Pontos ganhos ao atingir a respectiva parcial"],
    ]);
    wsI["!cols"] = [{ wch: 24 }, { wch: 80 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PNR");
    XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
    XLSX.writeFile(wb, "modelo_pnr.xlsx");
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
      const ordemIdx = find("ordem");
      let nameIdx = find("kpi", "indicador", "nome");
      const maxIdx = find("pontuacao total", "pontuacao", "pontos total");
      const ownerIdx = find("donos", "dono", "responsavel");
      const unitIdx = find("medida", "un.");
      const targetIdx = find("meta") ; // "Meta" mas evita "Meta Parcial"
      const partialHighIdx = headers.findIndex((h) => h.includes("parcial alta") && !h.includes("pontos"));
      const partialLowIdx = headers.findIndex((h) => h.includes("parcial baixa") && !h.includes("pontos"));
      const pointsHighIdx = headers.findIndex((h) => h.includes("pontos") && h.includes("alta"));
      const pointsLowIdx = headers.findIndex((h) => h.includes("pontos") && h.includes("baixa"));
      const dirIdx = find("direcao", "sentido");
      const conceitoIdx = find("conceito", "metrica", "descricao");
      if (nameIdx === -1) nameIdx = 1;

      // "Meta" pura: se o índice de "meta" caiu numa coluna de parcial, procurar a exata
      let realTargetIdx = targetIdx;
      const exactMeta = headers.findIndex((h) => h === "meta");
      if (exactMeta !== -1) realTargetIdx = exactMeta;

      const cell = (r: unknown[], idx: number) => (idx >= 0 ? r[idx] : "");
      const str = (r: unknown[], idx: number) => (idx >= 0 ? String(r[idx] ?? "").trim() : "");

      const parsed: PnrImportRow[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i] as unknown[];
        const name = str(r, nameIdx);
        if (!name) continue;
        parsed.push({
          ordem: str(r, ordemIdx),
          name,
          description: str(r, conceitoIdx),
          maxPoints: cell(r, maxIdx) as string | number,
          owner: str(r, ownerIdx),
          unit: str(r, unitIdx),
          target: cell(r, realTargetIdx) as string | number,
          direction: str(r, dirIdx),
          partialHigh: cell(r, partialHighIdx) as string | number,
          partialLow: cell(r, partialLowIdx) as string | number,
          pointsHigh: cell(r, pointsHighIdx) as string | number,
          pointsLow: cell(r, pointsLowIdx) as string | number,
        });
      }
      setRows(parsed); setFileName(file.name);
    } catch (e) {
      setParseError("Não consegui ler o arquivo: " + (e as Error).message);
    }
  }

  async function doImport() {
    setImporting(true);
    const res = await importPnr(rows);
    setImporting(false); setSummary(res);
    if (!res.error) router.refresh();
  }

  const kpiCount = rows.filter((r) => { const o = String(r.ordem ?? "").trim(); return o !== "-" && o !== ""; }).length;
  const sectionCount = rows.length - kpiCount;

  return (
    <>
      {!hideTrigger && <button type="button" className="btn btn-ghost" onClick={() => setInternalOpen(true)}><IconImport /> Importar indicadores</button>}
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
          <div className="card" style={{ width: "100%", maxWidth: 560, boxShadow: "var(--mh-shadow-e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Importar indicadores do PNR (.xlsx)</h2>
              <button type="button" onClick={close} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
            </div>

            <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div><button type="button" className="btn btn-ghost btn-sm" onClick={downloadTemplate}>↓ Baixar modelo</button></div>
              <div>
                <label className="label">Arquivo</label>
                <input type="file" accept=".xlsx,.xls,.csv" className="input" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              </div>

              {parseError && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{parseError}</p>}

              {fileName && !summary && (
                <div className="card card-pad" style={{ fontSize: "0.88rem" }}>
                  <strong>{fileName}</strong>
                  <div className="muted" style={{ marginTop: 4 }}>{sectionCount} seção(ões) · {kpiCount} indicador(es)</div>
                </div>
              )}

              {summary && (
                <div className="card card-pad" style={{ fontSize: "0.9rem" }}>
                  {summary.error ? (
                    <span className="badge badge-red">{summary.error}</span>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                        <span className="badge badge-green">{summary.kpis} indicador(es)</span>
                        <span className="badge badge-blue">{summary.categories} seção(ões)</span>
                        {summary.skipped > 0 && <span className="badge badge-amber">{summary.skipped} já existia(m)</span>}
                      </div>
                      {summary.ownersNotFound.length > 0 && (
                        <div className="muted" style={{ fontSize: "0.82rem" }}>Responsáveis não encontrados (ajuste depois): {summary.ownersNotFound.join(", ")}</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
              <button type="button" className="btn btn-ghost" onClick={close}>{summary && !summary.error ? "Fechar" : "Cancelar"}</button>
              <button type="button" className="btn btn-primary" disabled={!kpiCount || importing || (!!summary && !summary.error)} onClick={doImport}>
                {importing ? "Importando…" : "Importar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
