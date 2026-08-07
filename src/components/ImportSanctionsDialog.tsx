"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadXlsx } from "@/lib/xlsx-lazy";
import { importSanctions } from "@/lib/actions/rv-redutores";
import { IconImport } from "@/components/ui/ImpExpIcons";
import { useLeituraDePlanilha, AvisoLendoPlanilha } from "@/components/ui/LeituraDePlanilha";
// as MESMAS regras que o servidor aplica: se divergissem, a prévia mentiria
import {
  normTexto as norm, parseDataPlanilha, acharTipo,
  type SanctionImportRow, type SanctionImportResult,
} from "@/lib/sanctions-import";

/**
 * Importação de punições em lote.
 *
 * Mesmo desenho do importador de férias: baixar modelo, escolher arquivo, VER o
 * que vai entrar antes de confirmar. A conferência acontece duas vezes, aqui e
 * no servidor: aqui é para a pessoa enxergar o problema antes de gravar; lá é a
 * que vale.
 */

const fmtBR = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

export function ImportSanctionsDialog({
  members, types,
}: {
  members: { id: string; name: string }[];
  types: { id: string; name: string; active: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const { lendo, ler } = useLeituraDePlanilha();
  const [rows, setRows] = useState<SanctionImportRow[]>([]);
  const [ignored, setIgnored] = useState(0);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<SanctionImportResult | null>(null);
  const router = useRouter();

  function reset() { setRows([]); setIgnored(0); setFileName(""); setParseError(""); setSummary(null); }
  function close() { setOpen(false); reset(); }

  const analysis = useMemo(() => {
    const nomes = new Set(members.map((m) => norm(m.name)));
    return rows.map((r) => {
      const found = nomes.has(norm(r.name ?? ""));
      const notFound = !!r.name?.trim() && !found;
      const badDate = !r.occurredOn;
      const badType = acharTipo(r.type ?? "", types) === null;
      const invalid = !r.name?.trim() || badDate;
      return { row: r, notFound, invalid, badDate, badType, importable: found && !badDate && !badType };
    });
  }, [rows, members, types]);

  const counts = useMemo(() => ({
    ok: analysis.filter((a) => a.importable).length,
    notFound: analysis.filter((a) => a.notFound).length,
    badType: analysis.filter((a) => a.badType && !a.notFound && !a.invalid).length,
    invalid: analysis.filter((a) => a.invalid && !a.notFound).length,
  }), [analysis]);

  async function downloadTemplate() {
    const XLSX = await loadXlsx();
    const exemplo = members[0]?.name ?? "Fulano de Tal";
    const ativos = types.filter((t) => t.active);
    const tipo1 = ativos[0]?.name ?? "Advertência escrita";
    const tipo2 = ativos[1]?.name ?? tipo1;
    const ws = XLSX.utils.aoa_to_sheet([
      ["Colaborador", "Tipo", "Data", "Observação"],
      [exemplo, tipo1, "12/03/2026", "Atraso reiterado"],
      [exemplo, tipo2, "28/05/2026", ""],
    ]);
    ws["!cols"] = [{ wch: 34 }, { wch: 24 }, { wch: 12 }, { wch: 40 }];
    const wsI = XLSX.utils.aoa_to_sheet([
      ["Coluna", "Obrigatório", "Como preencher"],
      ["Colaborador", "Sim", "Nome exatamente como está no cadastro. Acento e maiúscula não importam."],
      ["Tipo", "Sim", "Um dos tipos cadastrados em Remuneração variável › Tipos de punição. O nome tem de bater; tipo desconhecido não é criado automaticamente."],
      ["Data", "Sim", "Data da punição, no formato DD/MM/AAAA. É o mês desta data que sofre o redutor."],
      ["Observação", "Não", "Texto livre."],
      ["", "", ""],
      ["Tipos cadastrados hoje", "", ativos.length > 0 ? ativos.map((t) => t.name).join(" · ") : "Nenhum. Cadastre em Remuneração variável › Tipos de punição antes de importar."],
      ["", "", ""],
      ["Reimportar a mesma planilha", "", "Não duplica. Mesma pessoa, mesmo tipo e mesma data é tratada como a mesma punição, e só a observação é atualizada."],
      ["O que a punição corta", "", "Nada por si só. Quem decide é o motivo cadastrado em Remuneração variável › Redutores, apontando para punição."],
    ]);
    wsI["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 100 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Punições");
    XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
    XLSX.writeFile(wb, "modelo_punicoes.xlsx");
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
      let nameIdx = find("colaborador", "nome", "funcionario");
      const typeIdx = find("tipo", "punicao", "sancao", "medida");
      const dateIdx = find("data", "ocorrencia", "aplicacao");
      const noteIdx = find("observacao", "obs", "motivo", "nota");
      if (nameIdx === -1) nameIdx = 0;
      const get = (r: unknown[], idx: number) => (idx >= 0 ? String(r[idx] ?? "").trim() : "");
      const parsed: SanctionImportRow[] = [];
      let ign = 0;
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i] as unknown[];
        const name = get(r, nameIdx);
        if (!name) { ign++; continue; }
        parsed.push({
          name,
          type: get(r, typeIdx),
          occurredOn: parseDataPlanilha(dateIdx >= 0 ? r[dateIdx] : ""),
          note: get(r, noteIdx),
        });
      }
      setRows(parsed); setIgnored(ign); setFileName(file.name);
    } catch (e) {
      setParseError("Não consegui ler o arquivo: " + (e as Error).message);
    }
  }

  async function doImport() {
    setImporting(true);
    const res = await importSanctions(rows);
    setImporting(false); setSummary(res);
    if (!res.error) router.refresh();
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}><IconImport /> Importar planilha</button>
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
          <div className="card" style={{ width: "100%", maxWidth: 560, boxShadow: "var(--mh-shadow-e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Importar punições (.xlsx)</h2>
              <button type="button" onClick={close} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
            </div>
            <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div><button type="button" className="btn btn-ghost btn-sm" onClick={downloadTemplate}>↓ Baixar modelo</button></div>
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
                    {counts.ok} punição(ões) a importar · {rows.length} linha(s){ignored > 0 && ` · ${ignored} ignorada(s)`}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
                    {counts.notFound > 0 && <span className="badge badge-red">{counts.notFound} colaborador não encontrado</span>}
                    {counts.badType > 0 && <span className="badge badge-red">{counts.badType} tipo fora do catálogo</span>}
                    {counts.invalid > 0 && <span className="badge badge-red">{counts.invalid} inválida(s) (data)</span>}
                  </div>
                  {rows.length > 0 && (
                    <ul className="muted" style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem", fontSize: "0.8rem", maxHeight: 170, overflow: "auto" }}>
                      {analysis.slice(0, 14).map((a, i) => (
                        <li key={i} style={{ color: a.importable ? undefined : "var(--text-soft)" }}>
                          {a.row.name}
                          {a.row.type ? ` · ${a.row.type}` : ""}
                          {a.row.occurredOn ? ` · ${fmtBR(a.row.occurredOn)}` : ""}
                          {a.notFound && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.62rem" }}>não encontrado</span>}
                          {!a.notFound && a.badDate && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.62rem" }}>data inválida</span>}
                          {!a.notFound && !a.badDate && a.badType && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.62rem" }}>tipo fora do catálogo</span>}
                        </li>
                      ))}
                      {rows.length > 14 && <li>… e mais {rows.length - 14}</li>}
                    </ul>
                  )}
                  <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.76rem" }}>
                    Mesma pessoa, mesmo tipo e mesma data não duplica: a observação é atualizada.
                  </p>
                </div>
              )}
              {summary && (
                <div className="card card-pad" style={{ fontSize: "0.9rem" }}>
                  {summary.error ? <span className="badge badge-red">{summary.error}</span> : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                      <span className="badge badge-green">{summary.imported} importada(s)</span>
                      {summary.updated > 0 && <span className="badge badge-blue">{summary.updated} atualizada(s)</span>}
                      {summary.unknownType > 0 && <span className="badge badge-amber">{summary.unknownType} tipo desconhecido</span>}
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
