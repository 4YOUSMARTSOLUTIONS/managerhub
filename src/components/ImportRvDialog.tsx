"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { loadXlsx } from "@/lib/xlsx-lazy";
import { importRvConfig, type RvConfigImportRow } from "@/lib/actions/rv-config";
import { IconImport } from "@/components/ui/ImpExpIcons";
import { useLeituraDePlanilha, AvisoLendoPlanilha } from "@/components/ui/LeituraDePlanilha";
import { indiceDeAlvos, resolverAlvo, MOTIVO_LABEL, type MotivoDeRecusa } from "@/lib/import-pessoa";

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const pad = (n: number) => String(n).padStart(2, "0");

function toMonth(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{4})$/); if (m) return `${m[2]}-${pad(+m[1])}`;
  m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/); if (m) return `${m[1]}-${pad(+m[2])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${pad(+m[2])}`;
  return "";
}

type Ref = { id: string; name: string; code?: string | null; units?: string[] };

export function ImportRvDialog({ scope, refs, unidades, open: openProp, onClose, hideTrigger }: { scope: "position" | "user"; refs: Ref[]; unidades: string[]; open?: boolean; onClose?: () => void; hideTrigger?: boolean }) {
  const label = scope === "position" ? "Função" : "Colaborador";
  const [internalOpen, setInternalOpen] = useState(false);
  const { lendo, ler } = useLeituraDePlanilha();
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const [rows, setRows] = useState<RvConfigImportRow[]>([]);
  const [ignored, setIgnored] = useState(0);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<{ imported: number; invalid: number; notFound: number; error?: string } | null>(null);
  const router = useRouter();

  function reset() { setRows([]); setIgnored(0); setFileName(""); setParseError(""); setSummary(null); }
  function close() { if (controlled) onClose?.(); else setInternalOpen(false); reset(); }

  const analysis = useMemo(() => {
    // função casa por NOME (item de catálogo); colaborador por unidade + matrícula
    const funcoes = scope === "position" ? new Set(refs.map((r) => norm(r.name))) : null;
    const idx = scope === "user" ? indiceDeAlvos(refs, unidades) : null;
    // mesma linha (alvo + competência) repetida: o servidor grava a última
    const vistos = new Set<string>();
    return rows.map((r) => {
      const badPeriod = !/^\d{4}-\d{2}$/.test((r.period ?? "").trim());
      const badValue = (r.value ?? "").trim() === "";
      let alvoKey: string | null = null;
      let motivo: MotivoDeRecusa | null = null;
      let invalid = badPeriod || badValue;
      let notFound = false;
      if (scope === "position") {
        const nome = norm(r.name ?? "");
        if (!nome) invalid = true;
        else if (funcoes!.has(nome)) alvoKey = nome;
        else notFound = true;
      } else {
        const alvo = resolverAlvo(r.code ?? "", r.unit ?? "", idx!);
        motivo = alvo.motivo;
        alvoKey = alvo.alvoId;
        if (motivo === "sem_matricula") invalid = true;
        notFound = motivo === "nao_encontrada";
      }
      const importable = !!alvoKey && !badPeriod && !badValue;
      const k = `${alvoKey ?? ""}|${(r.period ?? "").trim()}`;
      const duplicate = importable && vistos.has(k);
      if (importable) vistos.add(k);
      const mismatch = motivo === "precisa_unidade" || motivo === "unidade_nao_confere" || motivo === "duplicada_na_unidade";
      return { row: r, motivo, notFound, mismatch, invalid, duplicate, importable };
    });
  }, [rows, refs, unidades, scope]);
  const counts = useMemo(() => ({
    ok: analysis.filter((a) => a.importable && !a.duplicate).length,
    notFound: analysis.filter((a) => a.notFound).length,
    mismatch: analysis.filter((a) => a.mismatch).length,
    invalid: analysis.filter((a) => a.invalid && !a.notFound).length,
    duplicate: analysis.filter((a) => a.duplicate).length,
  }), [analysis]);

  async function downloadTemplate() {
    const XLSX = await loadXlsx();
    const example = refs[0]?.name ?? (scope === "position" ? "Analista" : "Fulano de Tal");
    // ID (matrícula) e Unidade só existem para colaborador; função é
    // identificada pelo nome (item de catálogo)
    const comId = scope === "user";
    const exampleId = refs[0]?.code ?? "";
    const exampleUn = refs[0]?.units?.[0] ?? unidades[0] ?? "";
    const multi = unidades.length > 1;
    const ws = XLSX.utils.aoa_to_sheet(comId ? [
      ["ID", "Unidade", label, "Competência", "Valor"],
      [exampleId, exampleUn, example, "07/2026", 300],
      [exampleId, exampleUn, example, "08/2026", 350],
    ] : [
      [label, "Competência", "Valor"],
      [example, "07/2026", 300],
      [example, "08/2026", 350],
    ]);
    ws["!cols"] = comId
      ? [{ wch: 12 }, { wch: 16 }, { wch: 28 }, { wch: 14 }, { wch: 12 }]
      : [{ wch: 28 }, { wch: 14 }, { wch: 12 }];
    const wsI = XLSX.utils.aoa_to_sheet([
      ["Coluna", "Obrigatório", "Como preencher"],
      ...(comId ? [
        ["ID", "Sim", "A matrícula do colaborador, como no cadastro (copie da aba Colaboradores). É ela que identifica, junto com a Unidade. O nome NÃO identifica."],
        ["Unidade", multi ? "Sim" : "Não", multi
          ? "Obrigatória: a empresa tem mais de uma unidade, e a mesma matrícula pode existir em unidades diferentes. Escreva o nome da unidade como cadastrado."
          : "A empresa tem uma única unidade; pode deixar em branco."],
      ] : []),
      comId
        ? [label, "Não", "Somente conferência visual. O sistema identifica por ID e Unidade, nunca pelo nome."]
        : [label, "Sim", "Nome da função exatamente como cadastrado"],
      ["Competência", "Sim", "Início da vigência, no formato MM/AAAA (ex.: 07/2026)"],
      ["Valor", "Sim", "Teto da RV em R$ (ex.: 300 ou 300,00). Use 0 para excluir da RV (só por colaborador)"],
    ]);
    wsI["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 80 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "RV");
    if (comId) {
      const wsC = XLSX.utils.aoa_to_sheet([["ID", "Unidade", label], ...refs.map((r) => [r.code ?? "", (r.units ?? []).join("; "), r.name])]);
      wsC["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 34 }];
      XLSX.utils.book_append_sheet(wb, wsC, "Colaboradores");
    }
    XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
    XLSX.writeFile(wb, `modelo_rv_${scope === "position" ? "funcao" : "colaborador"}.xlsx`);
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
      let nameIdx = scope === "position" ? find("funcao", "cargo") : find("colaborador", "nome", "responsavel");
      // "ID" casa por igualdade, não por trecho: "saida" contém "id"
      const idIdx = scope === "user" ? headers.findIndex((h) => h === "id" || h.includes("matricula") || h.startsWith("id do") || h.startsWith("id da") || h.includes("identificador")) : -1;
      const unitIdx = scope === "user" ? find("unidade", "empresa", "loja") : -1;
      const periodIdx = find("competencia", "compet", "vigencia", "mes", "periodo");
      const valueIdx = find("valor", "rv", "teto");
      if (nameIdx === -1) nameIdx = 0;
      const get = (r: unknown[], idx: number) => (idx >= 0 ? String(r[idx] ?? "").trim() : "");
      const parsed: RvConfigImportRow[] = [];
      let ign = 0;
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i] as unknown[];
        const name = get(r, nameIdx);
        const code = get(r, idIdx);
        if (!name && !code) { ign++; continue; }
        parsed.push({ name, code, unit: get(r, unitIdx), period: toMonth(periodIdx >= 0 ? r[periodIdx] : ""), value: get(r, valueIdx) });
      }
      setRows(parsed); setIgnored(ign); setFileName(file.name);
    } catch (e) {
      setParseError("Não consegui ler o arquivo: " + (e as Error).message);
    }
  }

  async function doImport() {
    setImporting(true);
    const res = await importRvConfig(scope, rows);
    setImporting(false);
    if (res.error) { setSummary(res); return; }
    // sucesso fecha sozinho; o resultado vai no toast para o retorno não sumir
    const avisos = [
      res.mismatch > 0 ? `${res.mismatch} com conflito de unidade/matrícula` : "",
      res.notFound > 0 ? `${res.notFound} não encontrado(s)` : "",
      res.invalid > 0 ? `${res.invalid} inválida(s)` : "",
    ].filter(Boolean).join(", ");
    toast.success(`${res.imported} vigência(s) importada(s)${avisos ? ` (${avisos})` : ""}`);
    router.refresh();
    close();
  }

  return (
    <>
      {!hideTrigger && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInternalOpen(true)}><IconImport /> Importar planilha</button>}
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
          <div className="card" style={{ width: "100%", maxWidth: 520, boxShadow: "var(--mh-shadow-e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Importar RV por {scope === "position" ? "função" : "colaborador"} (.xlsx)</h2>
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
                    {counts.ok} vigência(s) a importar · {rows.length} linha(s){ignored > 0 && ` · ${ignored} ignorada(s)`}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
                    {counts.notFound > 0 && <span className="badge badge-red">{counts.notFound} {scope === "position" ? "função não encontrada" : "matrícula não encontrada"}</span>}
                    {counts.mismatch > 0 && <span className="badge badge-red">{counts.mismatch} conflito de unidade/matrícula</span>}
                    {counts.invalid > 0 && <span className="badge badge-red">{counts.invalid} inválida(s) (competência/valor)</span>}
                    {counts.duplicate > 0 && <span className="badge badge-amber">{counts.duplicate} repetida(s), vale a última</span>}
                  </div>
                  {rows.length > 0 && (
                    <ul className="muted" style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem", fontSize: "0.8rem", maxHeight: 150, overflow: "auto" }}>
                      {analysis.slice(0, 14).map((a, i) => (
                        <li key={i} style={{ color: a.importable ? undefined : "var(--text-soft)" }}>
                          {a.row.name || a.row.code}{a.row.period ? ` · ${a.row.period}` : ""}{a.row.value ? ` · R$ ${a.row.value}` : ""}
                          {a.motivo && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.62rem" }}>{MOTIVO_LABEL[a.motivo]}</span>}
                          {!a.motivo && a.notFound && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.62rem" }}>não encontrada</span>}
                          {!a.motivo && !a.notFound && a.invalid && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.62rem" }}>inválida</span>}
                          {a.duplicate && <span className="badge badge-amber" style={{ marginLeft: 6, fontSize: "0.62rem" }}>repetida</span>}
                        </li>
                      ))}
                      {rows.length > 14 && <li>… e mais {rows.length - 14}</li>}
                    </ul>
                  )}
                </div>
              )}
              {summary && (
                <div className="card card-pad" style={{ fontSize: "0.9rem" }}>
                  {summary.error ? <span className="badge badge-red">{summary.error}</span> : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                      <span className="badge badge-green">{summary.imported} importada(s)</span>
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
