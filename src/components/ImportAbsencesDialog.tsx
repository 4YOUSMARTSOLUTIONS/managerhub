"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadXlsx } from "@/lib/xlsx-lazy";
import { importAbsences, type AbsenceImportRow, type AbsenceImportResult, type LinhaRecusada } from "@/lib/actions/absences";
import { IconImport } from "@/components/ui/ImpExpIcons";
import { useLeituraDePlanilha, AvisoLendoPlanilha } from "@/components/ui/LeituraDePlanilha";
// as MESMAS regras que o servidor aplica: se divergissem, a prévia mentiria
import { normTexto as norm, parseDataPlanilha, parseTipo } from "@/lib/absences-import";
import { indiceDeAlvos, resolverAlvo, MOTIVO_LABEL, ORIGEM_AVISO } from "@/lib/import-pessoa";

/**
 * Importação de férias e afastamentos em lote.
 *
 * Mesmo desenho do importador de RV: baixar modelo, escolher arquivo, VER o que
 * vai entrar antes de confirmar. A conferência acontece duas vezes, aqui e no
 * servidor, e é de propósito: aqui é para a pessoa enxergar o problema antes de
 * gravar; lá é a que vale.
 */

const fmtBR = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

export function ImportAbsencesDialog({ members, unidades }: { members: { id: string; name: string; code?: string | null; units?: string[] }[]; unidades: string[] }) {
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

  /**
   * As linhas recusadas viram planilha. Com centenas de linhas, ler selo por
   * selo na tela não é caminho: quem vai corrigir precisa do arquivo aberto ao
   * lado do original, com o número da linha para achar cada uma.
   */
  async function baixarRecusadas(itens: LinhaRecusada[], sufixo: string) {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Linha", "ID", "Unidade", "Colaborador", "Período", "Por que ficou de fora"],
      ...itens.map((i) => [i.linha, i.code, i.unit, i.name, i.periodo, i.motivo]),
    ]);
    ws["!cols"] = [{ wch: 7 }, { wch: 12 }, { wch: 16 }, { wch: 34 }, { wch: 24 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fora da importação");
    XLSX.writeFile(wb, `ferias_fora_da_importacao_${sufixo}.xlsx`);
  }

  /** o que a PRÉVIA recusaria, no mesmo formato do resumo do servidor */
  const recusadasDaPrevia = (): LinhaRecusada[] =>
    analysis
      .map((a, i) => ({ a, linha: i + 2 }))
      .filter(({ a }) => !a.importable)
      .map(({ a, linha }) => ({
        linha,
        code: (a.row.code ?? "").trim(),
        unit: (a.row.unit ?? "").trim(),
        name: (a.row.name ?? "").trim(),
        periodo: [a.row.start, a.row.end].filter(Boolean).map(fmtBR).join(" a "),
        motivo: a.motivo
          ? MOTIVO_LABEL[a.motivo]
          : a.badKind ? "Tipo não reconhecido" : "Datas inválidas",
      }));
  function close() { setOpen(false); reset(); }

  const analysis = useMemo(() => {
    const idx = indiceDeAlvos(members, unidades);
    return rows.map((r) => {
      const alvo = resolverAlvo(r.code ?? "", r.unit ?? "", idx);
      const badDates = !r.start || !r.end || r.end < r.start;
      const badKind = parseTipo(r.kind ?? "") === null;
      const invalid = alvo.motivo === "sem_matricula" || badDates || badKind;
      return {
        row: r,
        motivo: alvo.motivo,
        // lançamento em histórico entra, mas com selo: quem confere precisa ver
        // que aquela linha é de alguém desligado ou de um contrato antigo
        aviso: alvo.origem ? ORIGEM_AVISO[alvo.origem] : null,
        notFound: alvo.motivo === "nao_encontrada",
        mismatch: alvo.motivo === "precisa_unidade" || alvo.motivo === "unidade_nao_confere" || alvo.motivo === "duplicada_na_unidade",
        invalid, badKind,
        importable: !!alvo.alvoId && !badDates && !badKind,
      };
    });
  }, [rows, members, unidades]);

  const counts = useMemo(() => ({
    ok: analysis.filter((a) => a.importable).length,
    notFound: analysis.filter((a) => a.notFound).length,
    mismatch: analysis.filter((a) => a.mismatch).length,
    invalid: analysis.filter((a) => a.invalid && !a.notFound).length,
  }), [analysis]);

  async function downloadTemplate() {
    const XLSX = await loadXlsx();
    const exemplo = members[0]?.name ?? "Fulano de Tal";
    const exemploId = members[0]?.code ?? "";
    const exemploUn = members[0]?.units?.[0] ?? unidades[0] ?? "";
    const multi = unidades.length > 1;
    const ws = XLSX.utils.aoa_to_sheet([
      ["ID", "Unidade", "Colaborador", "Tipo", "Início", "Fim", "Desconta RV", "Observação"],
      [exemploId, exemploUn, exemplo, "Férias", "16/07/2026", "04/08/2026", "Sim", "1º período aquisitivo"],
      [exemploId, exemploUn, exemplo, "Atestado", "10/09/2026", "11/09/2026", "Não", ""],
    ]);
    ws["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 34 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 30 }];
    const wsI = XLSX.utils.aoa_to_sheet([
      ["Coluna", "Obrigatório", "Como preencher"],
      ["ID", "Sim", "A matrícula do colaborador, como no cadastro (copie da aba Colaboradores). É ela que identifica a pessoa, junto com a Unidade. O nome NÃO identifica."],
      ["Unidade", multi ? "Sim" : "Não", multi
        ? "Obrigatória: a empresa tem mais de uma unidade, e a mesma matrícula pode existir em unidades diferentes. Escreva o nome da unidade como cadastrado."
        : "A empresa tem uma única unidade; pode deixar em branco."],
      ["Colaborador", "Não", "Somente conferência visual. O sistema identifica por ID e Unidade, nunca pelo nome."],
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
    const wsC = XLSX.utils.aoa_to_sheet([["ID", "Unidade", "Colaborador"], ...members.map((m) => [m.code ?? "", (m.units ?? []).join("; "), m.name])]);
    wsC["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 34 }];
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
      const idIdx = headers.findIndex((h) => h === "id" || h.includes("matricula") || h.startsWith("id do") || h.startsWith("id da") || h.includes("identificador"));
      const unitIdx = find("unidade", "empresa", "loja");
      const kindIdx = find("tipo", "motivo");
      // "de" só por igualdade: "unidade" contém "de" e roubaria a coluna
      const startIdx = (() => { const i = find("inicio", "saida"); return i >= 0 ? i : headers.findIndex((h) => h === "de"); })();
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
        const code = get(r, idIdx);
        if (!name && !code) { ign++; continue; }
        parsed.push({
          name,
          code,
          unit: get(r, unitIdx),
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
                    {analysis.filter((a) => a.importable && a.aviso).length > 0 && (
                      <span className="badge badge-amber">{analysis.filter((a) => a.importable && a.aviso).length} em histórico (desligado ou contrato anterior)</span>
                    )}
                    {counts.notFound > 0 && <span className="badge badge-red">{counts.notFound} matrícula não encontrada</span>}
                    {counts.mismatch > 0 && <span className="badge badge-red">{counts.mismatch} conflito de unidade/matrícula</span>}
                    {counts.invalid > 0 && <span className="badge badge-red">{counts.invalid} inválida(s) (datas ou tipo)</span>}
                  </div>
                  {/* a lista mostra o que NÃO vai entrar: é isso que exige ação.
                      O que entra já está contado no topo. */}
                  {(() => {
                    const fora = analysis.filter((a) => !a.importable);
                    if (fora.length === 0) {
                      return rows.length > 0 ? <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.8rem" }}>Todas as linhas estão prontas para importar.</p> : null;
                    }
                    return (
                      <>
                        <div className="muted" style={{ margin: "0.6rem 0 0.25rem", fontSize: "0.78rem", fontWeight: 600 }}>
                          {fora.length} linha(s) ficam de fora:
                        </div>
                        <ul className="muted" style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.8rem", maxHeight: 200, overflow: "auto" }}>
                          {analysis.map((a, i) => ({ a, linha: i + 2 })).filter(({ a }) => !a.importable).slice(0, 60).map(({ a, linha }) => (
                            <li key={linha} style={{ color: "var(--text-soft)" }}>
                              linha {linha} · {a.row.code || "sem ID"}{a.row.unit ? ` · ${a.row.unit}` : ""}{a.row.name ? ` · ${a.row.name}` : ""}
                              {a.motivo && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.62rem" }}>{MOTIVO_LABEL[a.motivo]}</span>}
                              {!a.motivo && a.badKind && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.62rem" }}>tipo inválido</span>}
                              {!a.motivo && a.invalid && !a.badKind && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.62rem" }}>datas inválidas</span>}
                            </li>
                          ))}
                          {fora.length > 60 && <li>… e mais {fora.length - 60}. Baixe a lista para ver todas.</li>}
                        </ul>
                        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: "0.5rem" }}
                          onClick={() => void baixarRecusadas(recusadasDaPrevia(), "conferencia")}>
                          ↓ Baixar as {fora.length} linha(s) de fora
                        </button>
                      </>
                    );
                  })()}
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
                      {summary.mismatch > 0 && <span className="badge badge-red">{summary.mismatch} conflito de unidade/matrícula</span>}
                      {summary.invalid > 0 && <span className="badge badge-amber">{summary.invalid} inválida(s)</span>}
                    </div>
                  )}
                  {summary.rejeitadas?.length > 0 && (
                    <>
                      <div className="muted" style={{ margin: "0.6rem 0 0.25rem", fontSize: "0.78rem", fontWeight: 600 }}>
                        Ficaram de fora:
                      </div>
                      <ul className="muted" style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.8rem", maxHeight: 200, overflow: "auto" }}>
                        {summary.rejeitadas.slice(0, 60).map((i) => (
                          <li key={i.linha}>
                            linha {i.linha} · {i.code || "sem ID"}{i.unit ? ` · ${i.unit}` : ""}{i.name ? ` · ${i.name}` : ""}
                            <span className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.62rem" }}>{i.motivo}</span>
                          </li>
                        ))}
                        {summary.rejeitadas.length > 60 && <li>… e mais {summary.rejeitadas.length - 60}. Baixe a lista para ver todas.</li>}
                      </ul>
                      <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: "0.5rem" }}
                        onClick={() => void baixarRecusadas(summary.rejeitadas, "resultado")}>
                        ↓ Baixar as {summary.rejeitadas.length} linha(s) de fora
                      </button>
                    </>
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
