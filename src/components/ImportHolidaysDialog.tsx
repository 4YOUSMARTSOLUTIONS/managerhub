"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { importHolidays, type HolidayImportRow } from "@/lib/actions/holidays";
import { formatDate } from "@/lib/format";

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const pad = (n: number) => String(n).padStart(2, "0");

/** Converte um valor de célula (Date, número ou texto) em YYYY-MM-DD, ou "". */
function toISODay(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // dd/mm/aaaa
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); // aaaa-mm-dd
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  return "";
}

export function ImportHolidaysDialog() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<HolidayImportRow[]>([]);
  const [ignored, setIgnored] = useState(0);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<{ imported: number; skipped: number; error?: string } | null>(null);
  const router = useRouter();

  function reset() {
    setRows([]); setIgnored(0); setFileName(""); setParseError(""); setSummary(null);
  }
  function close() { setOpen(false); reset(); }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Data", "Nome"],
      ["25/12/2026", "Natal (exemplo — já é nacional)"],
      ["20/01/2026", "Aniversário da cidade"],
      ["09/07/2026", "Revolução Constitucionalista (SP)"],
    ]);
    ws["!cols"] = [{ wch: 16 }, { wch: 44 }];
    const wsI = XLSX.utils.aoa_to_sheet([
      ["Coluna", "Obrigatório", "Como preencher"],
      ["Data", "Sim", "Formato dd/mm/aaaa (ex.: 20/01/2026)"],
      ["Nome", "Sim", "Nome do feriado / dia não útil"],
      ["", "", "Feriados nacionais já são automáticos — cadastre aqui só os próprios."],
    ]);
    wsI["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 60 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Feriados");
    XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
    XLSX.writeFile(wb, "modelo_feriados.xlsx");
  }

  async function onFile(file: File) {
    setParseError(""); setSummary(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false });
      if (aoa.length < 2) { setParseError("Planilha vazia."); return; }

      const headers = (aoa[0] as unknown[]).map((h) => norm(String(h ?? "")));
      let dayIdx = headers.findIndex((h) => h.includes("data") || h.includes("dia"));
      let nameIdx = headers.findIndex((h) => h.includes("nome") || h.includes("feriado") || h.includes("descri"));
      // fallback: sem cabeçalho reconhecido, assume coluna 0 = data, 1 = nome
      if (dayIdx === -1) dayIdx = 0;
      if (nameIdx === -1) nameIdx = 1;

      const parsed: HolidayImportRow[] = [];
      let ign = 0;
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i] as unknown[];
        const day = toISODay(r[dayIdx]);
        const name = String(r[nameIdx] ?? "").trim();
        if (!day || !name) { ign++; continue; }
        parsed.push({ day, name });
      }
      setRows(parsed); setIgnored(ign); setFileName(file.name);
    } catch (e) {
      setParseError("Não consegui ler o arquivo: " + (e as Error).message);
    }
  }

  async function doImport() {
    setImporting(true);
    const res = await importHolidays(rows);
    setImporting(false); setSummary(res);
    if (!res.error) router.refresh();
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>↑ Importar planilha</button>
      {open && (
        <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 540, boxShadow: "var(--shadow)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Importar feriados (.xlsx)</h2>
              <button type="button" onClick={close} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
            </div>

            <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ background: "var(--surface-2)", borderRadius: 9, padding: "0.85rem 1rem", fontSize: "0.85rem" }}>
                <p style={{ margin: "0 0 0.5rem" }} className="muted">
                  Planilha com duas colunas: <strong>Data</strong> (dd/mm/aaaa) e <strong>Nome</strong>. Cada linha vira um
                  dia não útil / feriado próprio. Datas já existentes são atualizadas.
                </p>
                <button type="button" className="btn btn-ghost btn-sm" onClick={downloadTemplate}>↓ Baixar modelo</button>
              </div>

              <div>
                <label className="label">Arquivo</label>
                <input type="file" accept=".xlsx,.xls,.csv" className="input" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              </div>

              {parseError && <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>{parseError}</p>}

              {fileName && !summary && (
                <div className="card card-pad" style={{ fontSize: "0.88rem" }}>
                  <strong>{fileName}</strong>
                  <div className="muted" style={{ marginTop: 4 }}>
                    {rows.length} data(s) a importar{ignored > 0 && ` · ${ignored} linha(s) ignorada(s) (sem data/nome)`}
                  </div>
                  {rows.length > 0 && (
                    <ul className="muted" style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem", fontSize: "0.8rem", maxHeight: 150, overflow: "auto" }}>
                      {rows.slice(0, 12).map((r, i) => <li key={i}>{formatDate(r.day)} — {r.name}</li>)}
                      {rows.length > 12 && <li>… e mais {rows.length - 12}</li>}
                    </ul>
                  )}
                </div>
              )}

              {summary && (
                <div className="card card-pad" style={{ fontSize: "0.9rem" }}>
                  {summary.error ? (
                    <span className="badge badge-red">{summary.error}</span>
                  ) : (
                    <>
                      <span className="badge badge-green">{summary.imported} importado(s)</span>{" "}
                      {summary.skipped > 0 && <span className="badge badge-amber">{summary.skipped} ignorado(s)</span>}
                    </>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
              <button type="button" className="btn btn-ghost" onClick={close}>{summary && !summary.error ? "Fechar" : "Cancelar"}</button>
              <button type="button" className="btn btn-primary" disabled={!rows.length || importing || (!!summary && !summary.error)} onClick={doImport}>
                {importing ? "Importando…" : `Importar ${rows.length || ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
