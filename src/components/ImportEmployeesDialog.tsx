"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { importEmployees, type ImportSummary } from "@/lib/actions/employees";

type Row = Record<string, string>;

const TEMPLATE_HEADERS = [
  "Empresa", "Código Funcionário", "Nome Completo", "Admissão", "Função",
  "Perfil Função", "Setor", "Sub Setor", "Data de Nascimento", "CPF",
  "Demissão", "Sexo", "Telefone", "E-mail",
];

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

function fieldOf(header: string): string | null {
  const h = norm(header);
  if (h.includes("sub setor") || h.includes("subsetor")) return "subdepartment";
  if (h.startsWith("perfil")) return "level";
  if (h === "empresa" || h === "unidade") return "unit";
  if (h.includes("codigo") || h === "matricula") return "employee_code";
  if (h.includes("nome")) return "full_name";
  if (h.includes("admiss")) return "admission_date";
  if (h.includes("funcao")) return "position";
  if (h === "setor") return "department";
  if (h.includes("nascimento")) return "birth_date";
  if (h === "cpf") return "cpf";
  if (h.includes("demiss")) return "__demissao";
  if (h === "sexo") return "gender";
  if (h.includes("telefone") || h.includes("celular")) return "phone";
  if (h.includes("mail")) return "email";
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");
function cellStr(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  return String(v).trim();
}

export function ImportEmployeesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [ignored, setIgnored] = useState(0);
  const [dismissed, setDismissed] = useState(0);
  const [onlyActive, setOnlyActive] = useState(true);
  const [password, setPassword] = useState("Mudar@123");
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const router = useRouter();

  if (!open) return null;

  function downloadTemplate() {
    const ex1 = ["MATRIZ; FILIAL", "1001", "João da Silva", "01/02/2024", "Analista", "Pleno", "Comercial", "Vendas", "10/05/1990", "390.533.447-05", "", "Masculino", "(11) 99999-0000", "joao@empresa.com"];
    const ex2 = ["FILIAL", "1002", "Maria Souza", "15/08/2023", "Assistente", "Júnior", "Administrativo", "Financeiro", "02/11/1995", "111.444.777-35", "", "Feminino", "", ""];
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ex1, ex2]);
    ws["!cols"] = TEMPLATE_HEADERS.map(() => ({ wch: 22 }));

    const instr = [
      ["Coluna", "Obrigatório", "Como preencher"],
      ["Empresa", "Sim", "Unidade(s). Para mais de uma, separe por ; (ex.: MATRIZ; FILIAL)"],
      ["Código Funcionário", "Sim", "Matrícula do colaborador"],
      ["Nome Completo", "Sim", "Nome completo"],
      ["Admissão", "Sim", "Data no formato dd/mm/aaaa"],
      ["Função", "Sim", "Cargo (criado automaticamente se não existir)"],
      ["Perfil Função", "Não", "Ex.: Júnior, Pleno, Sênior"],
      ["Setor", "Sim", "Criado automaticamente se não existir"],
      ["Sub Setor", "Sim", "Subsetor dentro do setor"],
      ["Data de Nascimento", "Sim", "Formato dd/mm/aaaa"],
      ["CPF", "Sim", "Com ou sem pontuação"],
      ["Demissão", "Não", "Se preenchida (dd/mm/aaaa), o colaborador entra como INATIVO"],
      ["Sexo", "Sim", "Masculino / Feminino / Outro"],
      ["Telefone", "Não", "Opcional"],
      ["E-mail", "Não", "Se vazio, o login do colaborador será por CPF"],
    ];
    const wsI = XLSX.utils.aoa_to_sheet(instr);
    wsI["!cols"] = [{ wch: 22 }, { wch: 12 }, { wch: 64 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Colaboradores");
    XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
    XLSX.writeFile(wb, "modelo_colaboradores.xlsx");
  }

  async function onFile(file: File) {
    setParseError(""); setSummary(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false });
      if (aoa.length < 2) { setParseError("Planilha vazia."); return; }
      const headers = (aoa[0] as unknown[]).map((h) => fieldOf(String(h ?? "")));
      const parsed: Row[] = [];
      let ign = 0, dis = 0;
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i] as unknown[];
        const obj: Row = {};
        headers.forEach((f, idx) => { if (f) obj[f] = cellStr(r[idx]); });
        const isDismissed = !!obj["__demissao"];
        if (isDismissed) dis++;
        delete obj["__demissao"];
        if (!obj["cpf"] || !obj["full_name"]) { ign++; continue; }
        if (onlyActive && isDismissed) continue;
        parsed.push(obj);
      }
      setRows(parsed); setIgnored(ign); setDismissed(dis); setFileName(file.name);
    } catch (e) {
      setParseError("Não consegui ler o arquivo: " + (e as Error).message);
    }
  }

  async function doImport() {
    setImporting(true); setSummary(null); setProgress("");
    const CHUNK = 150;
    const agg: ImportSummary = { created: 0, skipped: 0, errors: [] };
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      setProgress(`Importando ${Math.min(i + part.length, rows.length)} de ${rows.length}…`);
      const res = await importEmployees(part, password);
      agg.created += res.created;
      agg.skipped += res.skipped;
      agg.errors.push(...res.errors);
    }
    setImporting(false); setProgress(""); setSummary(agg);
    router.refresh();
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 560, boxShadow: "var(--shadow)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Importar colaboradores</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ background: "var(--surface-2)", borderRadius: 9, padding: "0.85rem 1rem", fontSize: "0.85rem" }}>
            <p style={{ margin: "0 0 0.5rem" }} className="muted">
              Suba uma planilha (.xlsx) com os colaboradores. Use o modelo abaixo (tem uma aba “Instruções”).
              <br />• <strong>Várias unidades</strong>: separe por <code>;</code> na coluna Empresa (ex.: MATRIZ; FILIAL)
              <br />• <strong>Datas</strong> no formato <strong>dd/mm/aaaa</strong>
            </p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={downloadTemplate}>↓ Baixar modelo</button>
          </div>

          <div>
            <label className="label">Planilha de colaboradores</label>
            <input type="file" accept=".xlsx,.xls,.csv" className="input" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.88rem" }}>
            <input type="checkbox" checked={onlyActive} onChange={(e) => { setOnlyActive(e.target.checked); setRows([]); setFileName(""); }} />
            Importar apenas ativos (ignorar quem tem data de demissão)
          </label>

          <div>
            <label className="label">Senha inicial padrão (todos entram com ela + CPF)</label>
            <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} className="input" placeholder="Senha padrão" />
            <p className="soft" style={{ fontSize: "0.78rem", margin: "0.3rem 0 0" }}>Recomende que troquem no primeiro acesso.</p>
          </div>

          {parseError && <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>{parseError}</p>}

          {fileName && !summary && (
            <div className="card card-pad" style={{ fontSize: "0.88rem" }}>
              <strong>{fileName}</strong>
              <div className="muted" style={{ marginTop: 4 }}>
                {rows.length} colaborador(es) a importar
                {dismissed > 0 && ` · ${dismissed} com demissão${onlyActive ? " (ignorados)" : " (incluídos)"}`}
                {ignored > 0 && ` · ${ignored} sem CPF/nome (ignorados)`}
              </div>
            </div>
          )}

          {summary && (
            <div className="card card-pad" style={{ fontSize: "0.9rem" }}>
              <div className="badge badge-green" style={{ marginBottom: 6 }}>{summary.created} criados</div>{" "}
              {summary.skipped > 0 && <span className="badge badge-amber">{summary.skipped} já existiam</span>}{" "}
              {summary.errors.length > 0 && <span className="badge badge-red">{summary.errors.length} erros</span>}
              {summary.errors.length > 0 && (
                <ul className="muted" style={{ margin: "0.6rem 0 0", paddingLeft: "1.1rem", fontSize: "0.8rem", maxHeight: 160, overflow: "auto" }}>
                  {summary.errors.slice(0, 30).map((e, i) => <li key={i}>{e.nome ?? e.cpf ?? "?"}: {e.erro}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <span className="soft" style={{ fontSize: "0.82rem" }}>{progress}</span>
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>{summary ? "Fechar" : "Cancelar"}</button>
            <button type="button" className="btn btn-primary" disabled={!rows.length || importing || !!summary} onClick={doImport}>
              {importing ? "Importando…" : `Importar ${rows.length || ""}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
