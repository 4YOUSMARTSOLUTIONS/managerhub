"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { importAreaGoals, type AreaGoalImportRow } from "@/lib/actions/area-goals";
import { IconImport } from "@/components/ui/ImpExpIcons";

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

type Ref = { id: string; name: string };
type SubRef = { id: string; name: string; departmentId: string };
type ExistingRef = { name: string; departmentId: string | null; unitId: string | null };

export function ImportAreaGoalsDialog({
  departments, subdepartments, units, members, existing, open: openProp, onClose, hideTrigger,
}: {
  departments: Ref[];
  subdepartments: SubRef[];
  units: Ref[];
  members: Ref[];
  existing: ExistingRef[];
  open?: boolean;
  onClose?: () => void;
  hideTrigger?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const [rows, setRows] = useState<AreaGoalImportRow[]>([]);
  const [ignored, setIgnored] = useState(0);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<{ imported: number; invalid: number; duplicates: number; error?: string } | null>(null);
  const router = useRouter();

  function reset() {
    setRows([]); setIgnored(0); setFileName(""); setParseError(""); setSummary(null);
  }
  function close() { if (controlled) onClose?.(); else setInternalOpen(false); reset(); }

  // TODOS os campos são obrigatórios; nomes (unidade/setor/subsetor/responsável) precisam existir
  const analysis = useMemo(() => {
    const depByName = new Map(departments.map((d) => [norm(d.name), d.id]));
    const subByName = new Map(subdepartments.map((s) => [norm(s.name), s.departmentId]));
    const unitByName = new Map(units.map((u) => [norm(u.name), u.id]));
    const ownerSet = new Set(members.map((m) => norm(m.name)));
    const existSet = new Set(existing.map((e) => `${norm(e.name)}|${e.departmentId ?? ""}|${e.unitId ?? ""}`));
    const fileSeen = new Set<string>();
    return rows.map((r) => {
      const deptId = r.department ? depByName.get(norm(r.department)) ?? null : null;
      const subId = r.subdepartment ? subByName.get(norm(r.subdepartment)) ?? null : null;
      const unitId = r.orgUnit ? unitByName.get(norm(r.orgUnit)) ?? null : null;
      const ownerOk = !!r.owner && ownerSet.has(norm(r.owner));
      const missing: string[] = [];
      if (!r.name?.trim()) missing.push("Indicador");
      if (!unitId) missing.push("Unidade");
      if (!deptId) missing.push("Setor");
      if (!subId) missing.push("Subsetor");
      if (!r.unit?.trim()) missing.push("Un. medida");
      if (!r.kind?.trim()) missing.push("Tipo");
      if (!r.direction?.trim()) missing.push("Direção");
      if (!r.consolidation?.trim()) missing.push("Cálculo");
      if (!ownerOk) missing.push("Responsável");
      const incomplete = missing.length > 0;
      const key = `${norm(r.name)}|${deptId ?? ""}|${unitId ?? ""}`;
      const duplicate = !incomplete && (existSet.has(key) || fileSeen.has(key));
      if (!incomplete) fileSeen.add(key);
      const importable = !incomplete && !duplicate;
      return { row: r, missing, incomplete, duplicate, importable };
    });
  }, [rows, departments, subdepartments, units, members, existing]);

  const counts = useMemo(() => ({
    novos: analysis.filter((a) => a.importable).length,
    dup: analysis.filter((a) => a.duplicate).length,
    incompletas: analysis.filter((a) => a.incomplete).length,
  }), [analysis]);

  function downloadTemplate() {
    const unitExample = units[0]?.name ?? "MATRIZ";
    const ws = XLSX.utils.aoa_to_sheet([
      ["Indicador", "Unidade", "Setor", "Subsetor", "Un. medida", "Conceito", "Tipo", "IC pai", "Direção", "Cálculo", "Responsável"],
      ["Conciliação Financeira", unitExample, "Financeiro", "Cobrança", "%", "Nº conciliados ÷ total", "IC", "", "Maior é melhor", "Razão", "João Silva"],
      ["Baixa de Pagamentos", unitExample, "Financeiro", "Cobrança", "%", "Baixas no prazo ÷ total", "IV", "Conciliação Financeira", "Maior é melhor", "Razão", "João Silva"],
      ["Faturamento", unitExample, "Comercial", "Vendas", "R$", "", "IC", "", "Maior é melhor", "Soma", "Mariana Bastos"],
    ]);
    ws["!cols"] = [{ wch: 26 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 28 }, { wch: 8 }, { wch: 24 }, { wch: 18 }, { wch: 12 }, { wch: 22 }];
    const wsI = XLSX.utils.aoa_to_sheet([
      ["Coluna", "Obrigatório", "Como preencher"],
      ["Indicador", "Sim", "Nome do indicador (ex.: Faturamento, INAD, NPS)"],
      ["Unidade", "Sim", "Unidade do indicador (ex.: MATRIZ, FILIAL), como cadastrada. Importe as metas de cada unidade separadamente (não use \"Todas\")"],
      ["Setor", "Sim", "Nome do setor exatamente como cadastrado"],
      ["Subsetor", "Sim", "Nome do subsetor exatamente como cadastrado"],
      ["Un. medida", "Sim", "Unidade de medida: R$, %, un, pts…"],
      ["Conceito", "Não", "Como o indicador é medido / o que ele significa (texto livre)"],
      ["Tipo", "Sim", "IC (Índice de Controle) ou IV (Índice de Verificação)"],
      ["IC pai", "Não", "Nome do IC (mesma unidade) a que este indicador pertence. Ex.: 'Baixa de Pagamentos' tem IC pai 'Conciliação Financeira'. Deixe vazio para indicadores de topo"],
      ["Direção", "Sim", "\"Maior é melhor\" ou \"Menor é melhor\""],
      ["Cálculo", "Sim", "Soma, Média, Razão (Σnº ÷ Σtotal — ex.: SLA) ou Manual"],
      ["Responsável", "Sim", "Nome completo do responsável, como cadastrado"],
    ]);
    wsI["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 90 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Indicadores");
    XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
    XLSX.writeFile(wb, "modelo_metas_area.xlsx");
  }

  async function onFile(file: File) {
    setParseError(""); setSummary(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false });
      if (aoa.length < 2) { setParseError("Planilha vazia."); return; }

      const headers = (aoa[0] as unknown[]).map((h) => norm(String(h ?? "")));
      const find = (...keys: string[]) => headers.findIndex((h) => keys.some((k) => h.includes(k)));
      let nameIdx = find("indicador", "nome", "meta");
      const deptIdx = find("setor", "area");
      const subIdx = find("subsetor", "subarea", "subdepart");
      // "Un. medida" (R$, %) vs "Unidade" organizacional (MATRIZ/FILIAL)
      const measureIdx = headers.findIndex((h) => h.includes("medida") || h === "un.");
      const orgUnitIdx = headers.findIndex((h) => h.includes("unidade") && !h.includes("medida"));
      const kindIdx = find("tipo", "ic/iv", "ic-iv", "classificacao");
      const dirIdx = find("direcao", "sentido");
      const consIdx = find("calculo", "consolid", "grupo");
      const ownerIdx = find("responsavel", "dono", "gestor");
      const parentIdx = find("ic pai", "pai", "indicador pai");
      const conceitoIdx = find("conceito", "metrica", "descricao");
      if (nameIdx === -1) nameIdx = 0; // fallback: 1ª coluna = indicador

      const get = (r: unknown[], idx: number) => (idx >= 0 ? String(r[idx] ?? "").trim() : "");

      const parsed: AreaGoalImportRow[] = [];
      let ign = 0;
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i] as unknown[];
        const name = get(r, nameIdx);
        if (!name) { ign++; continue; }
        const orgUnitRaw = get(r, orgUnitIdx);
        parsed.push({
          name,
          orgUnit: norm(orgUnitRaw) === "todas" || norm(orgUnitRaw) === "todas as unidades" ? "" : orgUnitRaw,
          department: get(r, deptIdx),
          subdepartment: get(r, subIdx),
          unit: get(r, measureIdx),
          kind: get(r, kindIdx),
          direction: get(r, dirIdx),
          consolidation: get(r, consIdx),
          owner: get(r, ownerIdx),
          parent: get(r, parentIdx),
          description: get(r, conceitoIdx),
        });
      }
      setRows(parsed); setIgnored(ign); setFileName(file.name);
    } catch (e) {
      setParseError("Não consegui ler o arquivo: " + (e as Error).message);
    }
  }

  async function doImport() {
    setImporting(true);
    const res = await importAreaGoals(rows);
    setImporting(false); setSummary(res);
    if (!res.error) router.refresh();
  }

  return (
    <>
      {!hideTrigger && <button type="button" className="btn btn-ghost" onClick={() => setInternalOpen(true)}><IconImport /> Importar metas</button>}
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
          <div className="card" style={{ width: "100%", maxWidth: 560, boxShadow: "var(--mh-shadow-e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Importar indicadores da área (.xlsx)</h2>
              <button type="button" onClick={close} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
            </div>

            <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={downloadTemplate}>↓ Baixar modelo</button>
              </div>

              <div>
                <label className="label">Arquivo</label>
                <input type="file" accept=".xlsx,.xls,.csv" className="input" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              </div>

              {parseError && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{parseError}</p>}

              {fileName && !summary && (
                <div className="card card-pad" style={{ fontSize: "0.88rem" }}>
                  <strong>{fileName}</strong>
                  <div className="muted" style={{ marginTop: 4 }}>
                    {counts.novos} novo(s) · {rows.length} linha(s){ignored > 0 && ` · ${ignored} ignorada(s) (sem Indicador)`}
                  </div>
                </div>
              )}

              {summary && (
                <div className="card card-pad" style={{ fontSize: "0.9rem" }}>
                  {summary.error ? (
                    <span className="badge badge-red">{summary.error}</span>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                      <span className="badge badge-green">{summary.imported} importado(s)</span>
                      {summary.duplicates > 0 && <span className="badge badge-amber">{summary.duplicates} já existia(m)</span>}
                      {summary.invalid > 0 && <span className="badge badge-red">{summary.invalid} incompleta(s)</span>}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
              <button type="button" className="btn btn-ghost" onClick={close}>{summary && !summary.error ? "Fechar" : "Cancelar"}</button>
              <button type="button" className="btn btn-primary" disabled={!counts.novos || importing || (!!summary && !summary.error)} onClick={doImport}>
                {importing ? "Importando…" : `Importar ${counts.novos || ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
