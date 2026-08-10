"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadXlsx } from "@/lib/xlsx-lazy";
import { importAbsences, type AbsenceImportRow, type AbsenceImportResult } from "@/lib/actions/absences";
import { IconImport } from "@/components/ui/ImpExpIcons";
import { useLeituraDePlanilha, AvisoLendoPlanilha } from "@/components/ui/LeituraDePlanilha";
// as MESMAS regras que o servidor aplica: se divergissem, a prévia mentiria
import { normTexto as norm, parseDataPlanilha, parseTipo } from "@/lib/absences-import";
import { indiceDeAlvos, resolverAlvo } from "@/lib/import-pessoa";

/**
 * Importação de férias e afastamentos em lote.
 *
 * Mesmo desenho do importador de RV: baixar modelo, escolher arquivo, VER o que
 * vai entrar antes de confirmar. A conferência acontece duas vezes, aqui e no
 * servidor, e é de propósito: aqui é para a pessoa enxergar o problema antes de
 * gravar; lá é a que vale.
 */

const fmtBR = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

export function ImportAbsencesDialog({ members }: { members: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const { lendo, ler } = useLeituraDePlanilha();
  const [rows, setRows] = useState<AbsenceImportRow[]>([]);
  const [ignored, setIgnored] = useState(0);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<AbsenceImportResult | null>(null);
  const router = useRouter();

  function reset() { setRows([]); setIgnored(0); setFileName(""); setParseError(""); setSummary(null); }
  function close() { setOpen(false); reset(); }

  const analysis = useMemo(() => {
    const idx = indiceDeAlvos(members);
    return rows.map((r) => {
      const alvo = resolverAlvo(r.id ?? "", r.name ?? "", idx);
      const badDates = !r.start || !r.end || r.end < r.start;
      const badKind = parseTipo(r.kind ?? "") === null;
      const invalid = (!r.name?.trim() && !r.id?.trim()) || badDates || badKind;
      return { row: r, notFound: alvo.naoEncontrado, mismatch: alvo.divergente, invalid, badKind, importable: !!alvo.alvoId && !badDates && !badKind };
    });
  }, [rows, members]);

  const counts = useMemo(() => ({
    ok: analysis.filter((a) => a.importable).length,
    notFound: analysis.filter((a) => a.notFound).length,
    mismatch: analysis.filter((a) => a.mismatch).length,
    invalid: analysis.filter((a) => a.invalid && !a.notFound).length,
  }), [analysis]);

  async function downloadTemplate() {
    const XLSX = await loadXlsx();
    const exemplo = members[0]?.name ?? "Fulano de Tal";
    const exemploId = members[0]?.id ?? "";
    const ws = XLSX.utils.aoa_to_sheet([
      ["Colaborador", "ID", "Tipo", "Início", "Fim", "Desconta RV", "Observação"],
      [exemplo, exemploId, "Férias", "16/07/2026", "04/08/2026", "Sim", "1º período aquisitivo"],
      [exemplo, exemploId, "Atestado", "10/09/2026", "11/09/2026", "Não", ""],
    ]);
    ws["!cols"] = [{ wch: 34 }, { wch: 38 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 30 }];
    const wsI = XLSX.utils.aoa_to_sheet([
      ["Coluna", "Obrigatório", "Como preencher"],
      ["Colaborador", "Sim", "Nome como está no cadastro. Acento e maiúscula não importam. Com a coluna ID preenchida, vira só conferência."],
      ["ID", "Não", "Copie da aba Colaboradores. Quando preenchido, é ele que identifica a pessoa (evita erro de digitação e homônimos). Se ID e nome apontarem para pessoas diferentes, a linha é recusada."],
      ["Tipo", "Não", "Férias, Licença, Afastamento ou Atestado. Em branco vale Férias."],
      ["Início", "Sim", "Primeiro dia de ausência, no formato DD/MM/AAAA. Este dia conta como ausência."],
      ["Fim", "Sim", "Último dia de ausência, no formato DD/MM/AAAA. Este dia também conta."],
      ["Desconta RV", "Não", "Sim ou Não. Em branco vale o padrão do tipo: Férias, Licença e Afastamento descontam; Atestado não."],
      ["Observação", "Não", "Texto livre."],
      ["", "", ""],
      ["Como a RV é calculada", "", "O valor do mês fica proporcional aos dias trabalhados, em dias corridos. Julho tem 31 dias: quem sai de férias no dia 16 trabalhou 15 e recebe 15/31 do valor."],
      ["Reimportar a mesma planilha", "", "Não duplica. Período com as mesmas datas para a mesma pessoa é atualizado no lugar."],
      ["Períodos que se cruzam", "", "Uma pessoa não pode ter dois períodos sobrepostos. Linhas que cruzam com um período já lançado são recusadas e aparecem no resumo."],
    ]);
    wsI["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 100 }];
    const wsC = XLSX.utils.aoa_to_sheet([["Colaborador", "ID"], ...members.map((m) => [m.name, m.id])]);
    wsC["!cols"] = [{ wch: 34 }, { wch: 38 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ausências");
    XLSX.utils.book_append_sheet(wb, wsC, "Colaboradores");
    XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
    XLSX.writeFile(wb, "modelo_ferias_e_afastamentos.xlsx");
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
      // "ID" casa por igualdade, não por trecho: "saida" contém "id"
      const idIdx = headers.findIndex((h) => h === "id" || h.startsWith("id do") || h.startsWith("id da") || h.includes("identificador"));
      const kindIdx = find("tipo", "motivo");
      const startIdx = find("inicio", "de", "saida");
      const endIdx = find("fim", "termino", "ate", "retorno");
      const discIdx = find("desconta", "rv", "proporcional");
      const noteIdx = find("observacao", "obs", "nota");
      if (nameIdx === -1) nameIdx = 0;
      const get = (r: unknown[], idx: number) => (idx >= 0 ? String(r[idx] ?? "").trim() : "");
      const parsed: AbsenceImportRow[] = [];
      let ign = 0;
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i] as unknown[];
        const name = get(r, nameIdx);
        const id = get(r, idIdx);
        if (!name && !id) { ign++; continue; }
        parsed.push({
          name,
          id,
          kind: get(r, kindIdx),
          start: parseDataPlanilha(startIdx >= 0 ? r[startIdx] : ""),
          end: parseDataPlanilha(endIdx >= 0 ? r[endIdx] : ""),
          discounts: get(r, discIdx),
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
    const res = await importAbsences(rows);
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
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Importar férias e afastamentos (.xlsx)</h2>
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
                    {counts.ok} período(s) a importar · {rows.length} linha(s){ignored > 0 && ` · ${ignored} ignorada(s)`}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
                    {counts.notFound > 0 && <span className="badge badge-red">{counts.notFound} colaborador não encontrado</span>}
                    {counts.mismatch > 0 && <span className="badge badge-red">{counts.mismatch} ID e nome divergem</span>}
                    {counts.invalid > 0 && <span className="badge badge-red">{counts.invalid} inválida(s) (datas ou tipo)</span>}
                  </div>
                  {rows.length > 0 && (
                    <ul className="muted" style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem", fontSize: "0.8rem", maxHeight: 170, overflow: "auto" }}>
                      {analysis.slice(0, 14).map((a, i) => (
                        <li key={i} style={{ color: a.importable ? undefined : "var(--text-soft)" }}>
                          {a.row.name || a.row.id}
                          {a.row.kind ? ` · ${a.row.kind}` : ""}
                          {a.row.start ? ` · ${fmtBR(a.row.start)} a ${fmtBR(a.row.end) || "?"}` : ""}
                          {a.notFound && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.62rem" }}>não encontrado</span>}
                          {a.mismatch && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.62rem" }}>ID e nome divergem</span>}
                          {!a.notFound && a.badKind && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.62rem" }}>tipo inválido</span>}
                          {!a.notFound && a.invalid && !a.badKind && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.62rem" }}>datas inválidas</span>}
                        </li>
                      ))}
                      {rows.length > 14 && <li>… e mais {rows.length - 14}</li>}
                    </ul>
                  )}
                  <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.76rem" }}>
                    Períodos com as mesmas datas já lançados são atualizados, não duplicados.
                  </p>
                </div>
              )}
              {summary && (
                <div className="card card-pad" style={{ fontSize: "0.9rem" }}>
                  {summary.error ? <span className="badge badge-red">{summary.error}</span> : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                      <span className="badge badge-green">{summary.imported} importado(s)</span>
                      {summary.updated > 0 && <span className="badge badge-blue">{summary.updated} atualizado(s)</span>}
                      {summary.overlapping > 0 && <span className="badge badge-amber">{summary.overlapping} sobreposto(s)</span>}
                      {summary.notFound > 0 && <span className="badge badge-red">{summary.notFound} não encontrado(s)</span>}
                      {summary.mismatch > 0 && <span className="badge badge-red">{summary.mismatch} ID e nome divergem</span>}
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
