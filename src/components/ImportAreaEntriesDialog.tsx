"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadXlsx } from "@/lib/xlsx-lazy";
import { importAreaEntries, type AreaEntryImportRow } from "@/lib/actions/area-goals";
import { IconImport } from "@/components/ui/ImpExpIcons";
import { useLeituraDePlanilha, AvisoLendoPlanilha } from "@/components/ui/LeituraDePlanilha";

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const pad = (n: number) => String(n).padStart(2, "0");

/** Converte competência (Date, "MM/AAAA", "AAAA-MM", "dd/mm/aaaa") em "AAAA-MM" ou "". */
function toMonth(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{4})$/); if (m) return `${m[2]}-${pad(+m[1])}`;
  m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/); if (m) return `${m[1]}-${pad(+m[2])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${pad(+m[2])}`;
  return "";
}

type Ref = { id: string; name: string };
type GoalRef = { name: string; departmentId: string | null; unitId: string | null; consolidation: string };

export function ImportAreaEntriesDialog({ departments, units, goals, open: openProp, onClose, hideTrigger }: { departments: Ref[]; units: Ref[]; goals: GoalRef[]; open?: boolean; onClose?: () => void; hideTrigger?: boolean }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const { lendo, ler } = useLeituraDePlanilha();
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const [rows, setRows] = useState<AreaEntryImportRow[]>([]);
  const [ignored, setIgnored] = useState(0);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<{ imported: number; invalid: number; notFound: number; error?: string } | null>(null);
  const router = useRouter();

  function reset() { setRows([]); setIgnored(0); setFileName(""); setParseError(""); setSummary(null); }
  function close() { if (controlled) onClose?.(); else setInternalOpen(false); reset(); }

  const analysis = useMemo(() => {
    const depByName = new Map(departments.map((d) => [norm(d.name), d.id]));
    const unitByName = new Map(units.map((u) => [norm(u.name), u.id]));
    return rows.map((r) => {
      const unitId = r.orgUnit ? unitByName.get(norm(r.orgUnit)) ?? null : null;
      const period = (r.period ?? "").trim();
      let cands = goals.filter((g) => norm(g.name) === norm(r.name ?? "") && g.unitId === unitId);
      if (cands.length > 1 && r.department) {
        const deptId = depByName.get(norm(r.department));
        if (deptId) cands = cands.filter((g) => g.departmentId === deptId);
      }
      const found = unitId != null && cands.length === 1 ? cands[0] : null;
      const isRatio = found?.consolidation === "razao";
      const hasValue = isRatio
        ? (r.numerator ?? "").trim() !== "" && (r.denominator ?? "").trim() !== ""
        : (r.meta ?? "").trim() !== "" || (r.realizado ?? "").trim() !== "";
      const notFound = !found;
      const badPeriod = !/^\d{4}-\d{2}$/.test(period);
      const invalid = !r.name?.trim() || !unitId || badPeriod || (!!found && !hasValue);
      const importable = !!found && !badPeriod && hasValue;
      return { row: r, found, notFound: notFound && !!unitId && !!r.name?.trim(), badPeriod, invalid, importable, isRatio };
    });
  }, [rows, departments, units, goals]);

  const counts = useMemo(() => ({
    ok: analysis.filter((a) => a.importable).length,
    notFound: analysis.filter((a) => a.notFound).length,
    invalid: analysis.filter((a) => a.invalid && !a.notFound).length,
  }), [analysis]);

  async function downloadTemplate() {
    const XLSX = await loadXlsx();
    const unitExample = units[0]?.name ?? "MATRIZ";
    const ws = XLSX.utils.aoa_to_sheet([
      ["Indicador", "Unidade", "Setor", "Competência", "Meta", "Realizado", "Numerador", "Denominador"],
      ["Faturamento", unitExample, "Comercial", "07/2026", 1000000, 950000, "", ""],
      ["INAD", unitExample, "Financeiro", "07/2026", 0.5, "", 55, 10000],
      ["Prazo Médio (Dias)", unitExample, "Financeiro", "07/2026", 30, 28, "", ""],
    ]);
    ws["!cols"] = [{ wch: 24 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    const wsI = XLSX.utils.aoa_to_sheet([
      ["Coluna", "Obrigatório", "Como preencher"],
      ["Indicador", "Sim", "Nome do indicador exatamente como cadastrado"],
      ["Unidade", "Sim", "Unidade do indicador (MATRIZ, FILIAL…) — casa com o indicador daquela unidade"],
      ["Setor", "Não", "Só é usado se houver mais de um indicador com o mesmo nome/unidade"],
      ["Competência", "Sim", "Mês do resultado, no formato MM/AAAA (ex.: 07/2026)"],
      ["Meta", "Não", "Meta do período (número). Para % use ponto/vírgula decimal (ex.: 0,5)"],
      ["Realizado", "Cond.", "Realizado do período — para indicadores Soma/Média/Manual"],
      ["Numerador", "Cond.", "Para indicadores Razão (ex.: chamados no prazo). O sistema calcula o % = nº ÷ total"],
      ["Denominador", "Cond.", "Para indicadores Razão (ex.: total de chamados)"],
    ]);
    wsI["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 80 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resultados");
    XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
    XLSX.writeFile(wb, "modelo_resultados_area.xlsx");
  }

  async function onFile(file: File) {
    const XLSX = await loadXlsx();
    setParseError(""); setSummary(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false });
      if (aoa.length < 2) { setParseError("Planilha vazia."); return; }
      const headers = (aoa[0] as unknown[]).map((h) => norm(String(h ?? "")));
      const find = (...keys: string[]) => headers.findIndex((h) => keys.some((k) => h.includes(k)));
      let nameIdx = find("indicador", "nome", "meta ");
      const orgUnitIdx = headers.findIndex((h) => h.includes("unidade") && !h.includes("medida"));
      const deptIdx = find("setor", "area");
      const periodIdx = find("competencia", "compet", "mes", "periodo");
      const metaIdx = headers.findIndex((h) => h === "meta" || h.startsWith("meta"));
      const realIdx = find("realizado", "real");
      const numIdx = find("numerador", "numero", "no prazo");
      const denIdx = find("denominador", "total");
      if (nameIdx === -1) nameIdx = 0;
      const get = (r: unknown[], idx: number) => (idx >= 0 ? String(r[idx] ?? "").trim() : "");

      const parsed: AreaEntryImportRow[] = [];
      let ign = 0;
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i] as unknown[];
        const name = get(r, nameIdx);
        if (!name) { ign++; continue; }
        parsed.push({
          name,
          orgUnit: get(r, orgUnitIdx),
          department: get(r, deptIdx),
          period: toMonth(periodIdx >= 0 ? r[periodIdx] : ""),
          meta: get(r, metaIdx),
          realizado: get(r, realIdx),
          numerator: get(r, numIdx),
          denominator: get(r, denIdx),
        });
      }
      setRows(parsed); setIgnored(ign); setFileName(file.name);
    } catch (e) {
      setParseError("Não consegui ler o arquivo: " + (e as Error).message);
    }
  }

  async function doImport() {
    setImporting(true);
    const res = await importAreaEntries(rows);
    setImporting(false); setSummary(res);
    if (!res.error) router.refresh();
  }

  return (
    <>
      {!hideTrigger && <button type="button" className="btn btn-ghost" onClick={() => setInternalOpen(true)}><IconImport /> Importar resultados</button>}
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
          <div className="card" style={{ width: "100%", maxWidth: 560, boxShadow: "var(--mh-shadow-e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Importar resultados da área (.xlsx)</h2>
              <button type="button" onClick={close} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
            </div>

            <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={downloadTemplate}>↓ Baixar modelo</button>
              </div>
              <div>
                <label className="label">Arquivo</label>
                <input type="file" accept=".xlsx,.xls,.csv" className="input" disabled={lendo}
                  // limpa o value depois de ler: sem isso, reescolher o MESMO
                  // arquivo nao dispara o onChange e parece que nada aconteceu
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) ler(() => onFile(f)); }} />
                <AvisoLendoPlanilha lendo={lendo} />
              </div>

              {parseError && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{parseError}</p>}

              {fileName && !summary && (
                <div className="card card-pad" style={{ fontSize: "0.88rem" }}>
                  <strong>{fileName}</strong>
                  <div className="muted" style={{ marginTop: 4 }}>
                    {counts.ok} resultado(s) a lançar · {rows.length} linha(s){ignored > 0 && ` · ${ignored} ignorada(s) (sem Indicador)`}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
                    {counts.notFound > 0 && <span className="badge badge-red">{counts.notFound} indicador não encontrado</span>}
                    {counts.invalid > 0 && <span className="badge badge-red">{counts.invalid} inválida(s) (competência/valor)</span>}
                  </div>
                  {rows.length > 0 && (
                    <ul className="muted" style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem", fontSize: "0.8rem", maxHeight: 160, overflow: "auto" }}>
                      {analysis.slice(0, 14).map((a, i) => (
                        <li key={i} style={{ color: a.importable ? undefined : "var(--text-soft)" }}>
                          {a.row.name}{a.row.orgUnit ? ` · ${a.row.orgUnit}` : ""}{a.row.period ? ` · ${a.row.period}` : ""}
                          {a.notFound && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.62rem" }}>não encontrado</span>}
                          {!a.notFound && a.invalid && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.62rem" }} title="Competência (MM/AAAA) e/ou valores">inválida</span>}
                        </li>
                      ))}
                      {rows.length > 14 && <li>… e mais {rows.length - 14}</li>}
                    </ul>
                  )}
                </div>
              )}

              {summary && (
                <div className="card card-pad" style={{ fontSize: "0.9rem" }}>
                  {summary.error ? (
                    <span className="badge badge-red">{summary.error}</span>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                      <span className="badge badge-green">{summary.imported} lançado(s)</span>
                      {summary.notFound > 0 && <span className="badge badge-red">{summary.notFound} não encontrado(s)</span>}
                      {summary.invalid > 0 && <span className="badge badge-amber">{summary.invalid} inválida(s)</span>}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
              <button type="button" className="btn btn-ghost" onClick={close}>{summary && !summary.error ? "Fechar" : "Cancelar"}</button>
              <button type="button" className="btn btn-primary" disabled={!counts.ok || importing || (!!summary && !summary.error)} onClick={doImport}>
                {importing ? "Importando…" : `Importar ${counts.ok || ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
