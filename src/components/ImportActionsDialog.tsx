"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loadXlsx } from "@/lib/xlsx-lazy";
import { importActions, type ActionImportRow, type ActionImportResult } from "@/lib/actions/actions";
import { IconImport } from "@/components/ui/ImpExpIcons";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

function toISODate(v: unknown): string {
  if (v == null || v === "") return "";
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, "0"), d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  const br = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (br) {
    const y = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${y}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return "";
}

/**
 * Converte data (e hora, quando houver) para um instante ISO no fuso do navegador.
 *
 * Mandar só "AAAA-MM-DD" para uma coluna de timestamp faz o banco assumir meia-noite
 * UTC, que no Brasil vira 21:00 do DIA ANTERIOR. Por isso o dia vira um instante
 * explícito: com a hora do arquivo quando existe, ou meio-dia local quando não existe
 * (meio-dia nunca "vira o dia" em nenhum fuso).
 */
function toInstant(isoDay: string, hhmm?: string): string {
  if (!isoDay) return "";
  const [y, m, d] = isoDay.split("-").map(Number);
  const [hh, mi] = hhmm ? hhmm.split(":").map(Number) : [12, 0];
  return new Date(y, m - 1, d, hh || 0, mi || 0).toISOString();
}

// Cabeçalho do formato nativo do sistema antigo: "[dd/mm/aaaa hh:mm] AUTOR: texto".
// Vários comentários por célula, separados por esse cabeçalho (o texto pode ter quebras de linha).
const NATIVE_COMMENT_HEADER = /\[(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2})(?::\d{2})?\]\s*([^:\n]+?):\s*/g;

// Comentários: aceita o formato nativo "[data hora] autor: texto" (migração) OU,
// como fallback, uma linha por comentário "data | autor | texto" (data e autor opcionais).
function parseComments(cell: unknown): { at: string; author: string; text: string }[] {
  const raw = String(cell ?? "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [];

  const heads = [...raw.matchAll(NATIVE_COMMENT_HEADER)];
  if (heads.length > 0) {
    const out: { at: string; author: string; text: string }[] = [];
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      const start = (h.index ?? 0) + h[0].length;
      const end = i + 1 < heads.length ? (heads[i + 1].index ?? raw.length) : raw.length;
      const text = raw.slice(start, end).trim();
      // h[2] é a hora do arquivo: preserva o horário real do comentário
      if (text) out.push({ at: toInstant(toISODate(h[1]), h[2]), author: h[3].trim(), text });
    }
    if (out.length > 0) return out;
  }

  return raw.split(/\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length >= 3) return { at: toInstant(toISODate(parts[0])), author: parts[1], text: parts.slice(2).join(" | ") };
    if (parts.length === 2) {
      const d = toISODate(parts[0]);
      return d ? { at: toInstant(d), author: "", text: parts[1] } : { at: "", author: parts[0], text: parts[1] };
    }
    return { at: "", author: "", text: parts[0] };
  }).filter((c) => c.text);
}

export function ImportActionsDialog({ open: openProp, onClose, hideTrigger }: { open?: boolean; onClose?: () => void; hideTrigger?: boolean } = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const [rows, setRows] = useState<ActionImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<ActionImportResult | null>(null);
  const router = useRouter();

  function reset() { setRows([]); setFileName(""); setParseError(""); setSummary(null); setProgress(null); }
  function close() { if (controlled) onClose?.(); else setInternalOpen(false); reset(); }

  async function downloadTemplate() {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Ação", "Responsáveis", "Solicitante", "Criada por", "Data de criação", "Reunião", "Prazo", "Data de conclusão", "Status", "Prioridade", "Unidade", "KPI", "Ferramenta", "SDPO", "Programa", "Pilar", "Seção", "Bloco", "Item", "Comentários"],
      ["Renegociar contrato com fornecedor X", "João Silva; Maria Souza", "Luiz Nobre", "Luiz Nobre", "10/08/2026", "RLP - Reunião de Limpa Pauta", "30/09/2026", "20/09/2026", "Concluída", "Alta", "MATRIZ", "", "PDCA", "Não", "", "", "", "", "", "31/08/2026 | João Silva | Fornecedor pediu reunião\n05/09/2026 | Maria Souza | Aguardando proposta"],
      ["Revisar layout do depósito", "Maria Souza", "Luiz Nobre", "Maria Souza", "05/09/2026", "", "2026-10-15", "", "Em andamento", "Média", "Todas as unidades", "", "", "Sim", "SPO", "Segurança", "", "", "", ""],
    ]);
    ws["!cols"] = [{ wch: 40 }, { wch: 26 }, { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 28 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 40 }];
    const wsI = XLSX.utils.aoa_to_sheet([
      ["Coluna", "Como preencher"],
      ["Ação", "Descrição da ação/demanda (obrigatório)"],
      ["Responsáveis", "Nome(s) completo(s) como cadastrado(s), separados por ; — opcional"],
      ["Solicitante", "Nome completo do solicitante. Se vazio, usa você (quem importa)"],
      ["Criada por", "Nome completo de quem criou a ação no sistema antigo. Se vazio, usa você"],
      ["Data de criação", "Data em que a ação foi criada (DD/MM/AAAA ou AAAA-MM-DD). Se vazio, usa a data de hoje"],
      ["Reunião", "Nome da reunião (série) em que a ação foi criada, se aplicável — opcional"],
      ["Prazo", "Data limite da ação (DD/MM/AAAA ou AAAA-MM-DD) — opcional"],
      ["Data de conclusão", "Data em que foi concluída (se status Concluída/Cancelada) — opcional"],
      ["Status", "Aberta, Em andamento, Bloqueada, Concluída ou Cancelada (padrão: Aberta; ou Concluída se houver data de conclusão)"],
      ["Prioridade", "Baixa, Média, Alta ou Urgente (padrão: Média)"],
      ["Unidade", "Nome da unidade cadastrada. Use \"Todas as unidades\" (ou deixe vazio) para valer para todas"],
      ["KPI", "Nome do KPI cadastrado — opcional"],
      ["Ferramenta", "Nome da ferramenta de gestão (ex.: PDCA, 5W2H) — opcional"],
      ["SDPO", "Sim ou Não. Se vazio, marca Sim automaticamente quando Pilar, Seção e Item forem encontrados"],
      ["Programa", "SPO ou DPO — opcional"],
      ["Pilar / Seção / Item", "Classificação SDPO (nomes cadastrados). Preencha Pilar, Seção e Item para marcar como SDPO"],
      ["Bloco", "Bloco dentro da seção (opcional, usado no DPO)"],
      ["Comentários", "Histórico de comentários (opcional). Um por linha na célula (Alt+Enter). Cada linha: \"data | autor | texto\". Data e autor são opcionais; sem autor cadastrado, entra como você."],
    ]);
    wsI["!cols"] = [{ wch: 22 }, { wch: 92 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ações");
    XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
    XLSX.writeFile(wb, "modelo_acoes.xlsx");
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
      const idx = {
        descricao: find("acao", "ação", "acoes", "descricao", "tarefa"),
        responsaveis: find("responsav", "responsáv"),
        solicitante: find("solicitante"),
        criadaPor: find("criada por", "criado por", "criador", "autor"),
        dataCriacao: find("data de criacao", "data criacao", "criacao", "criação", "abertura"),
        reuniao: find("reuniao", "reunião", "serie", "série"),
        prazo: find("prazo"),
        dataConclusao: find("data de conclusao", "conclusao", "conclusão", "conclu", "finalizacao", "fechamento"),
        status: find("status", "situacao", "situação"),
        prioridade: find("prioridade"),
        unidade: find("unidade"),
        kpi: find("kpi", "indicador"),
        ferramenta: find("ferramenta"),
        sdpo: find("sdpo"),
        programa: find("programa"),
        pilar: find("pilar"),
        secao: find("secao", "seção", "secção"),
        bloco: find("bloco"),
        item: find("item"),
        comentarios: find("comentario", "comentário", "comment"),
      };
      if (idx.descricao === -1) { setParseError("Não encontrei a coluna 'Ação'. Baixe o modelo."); return; }

      const str = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
      const parsed: ActionImportRow[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i] as unknown[];
        const descricao = str(r, idx.descricao);
        if (!descricao) continue;
        parsed.push({
          descricao,
          responsaveis: str(r, idx.responsaveis),
          solicitante: str(r, idx.solicitante),
          criadaPor: str(r, idx.criadaPor),
          // criação/conclusão vão para colunas de timestamp: viram instante ao meio-dia local
          dataCriacao: toInstant(toISODate(idx.dataCriacao >= 0 ? r[idx.dataCriacao] : "")),
          reuniao: str(r, idx.reuniao),
          prazo: toISODate(idx.prazo >= 0 ? r[idx.prazo] : ""),
          dataConclusao: toInstant(toISODate(idx.dataConclusao >= 0 ? r[idx.dataConclusao] : "")),
          status: str(r, idx.status),
          prioridade: str(r, idx.prioridade),
          unidade: str(r, idx.unidade),
          kpi: str(r, idx.kpi),
          ferramenta: str(r, idx.ferramenta),
          sdpo: str(r, idx.sdpo),
          programa: str(r, idx.programa),
          pilar: str(r, idx.pilar),
          secao: str(r, idx.secao),
          bloco: str(r, idx.bloco),
          item: str(r, idx.item),
          comentarios: idx.comentarios >= 0 ? parseComments(r[idx.comentarios]) : [],
        });
      }
      if (parsed.length === 0) { setParseError("Nenhuma linha com ação encontrada."); return; }
      setRows(parsed); setFileName(file.name);
    } catch (e) {
      setParseError("Não consegui ler o arquivo: " + (e as Error).message);
    }
  }

  async function doImport() {
    setImporting(true);
    setSummary(null);
    setProgress({ done: 0, total: rows.length });

    // Importa em lotes para não estourar o tempo de uma única requisição (migração grande).
    const BATCH = 150;
    const merged: ActionImportResult = { created: 0, skipped: 0, peopleNotFound: [], refsNotFound: [], failed: [] };
    const people = new Set<string>(); const refs = new Set<string>();
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      let res: ActionImportResult;
      try {
        res = await importActions(chunk);
      } catch (e) {
        merged.error = `Falha de conexão no lote ${Math.floor(i / BATCH) + 1}: ${(e as Error).message}. ${merged.created} ação(ões) já foram importadas.`;
        break;
      }
      if (res.error) { merged.error = res.error; break; } // erro fatal (ex.: sem permissão)
      merged.created += res.created;
      merged.skipped += res.skipped;
      res.peopleNotFound.forEach((x) => people.add(x));
      res.refsNotFound.forEach((x) => refs.add(x));
      merged.failed.push(...res.failed);
      setProgress({ done: Math.min(i + BATCH, rows.length), total: rows.length });
    }
    merged.peopleNotFound = [...people];
    merged.refsNotFound = [...refs];
    setImporting(false); setProgress(null); setSummary(merged);
    router.refresh();
  }

  return (
    <>
      {!hideTrigger && <button type="button" className="btn btn-ghost" onClick={() => setInternalOpen(true)}><IconImport /> Importar ações</button>}
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
          <div className="card" style={{ width: "100%", maxWidth: 580, boxShadow: "var(--mh-shadow-e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Importar ações (.xlsx)</h2>
              <button type="button" onClick={close} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
            </div>

            <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
                Migração do histórico: cada linha vira uma ação preservando a <strong>data de criação</strong>, quem <strong>criou</strong>, a <strong>reunião</strong>, o <strong>status</strong> e a <strong>data de conclusão</strong> informados. Nomes de pessoas, reunião, unidade, KPI, ferramenta e SDPO são resolvidos pelos cadastros; o que não for encontrado é listado para ajuste depois.
              </p>
              <div><button type="button" className="btn btn-ghost btn-sm" onClick={downloadTemplate}>↓ Baixar modelo</button></div>
              <div>
                <label className="label">Arquivo</label>
                <input type="file" accept=".xlsx,.xls,.csv" className="input" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              </div>

              {parseError && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{parseError}</p>}

              {fileName && !summary && !importing && (
                <div className="card card-pad" style={{ fontSize: "0.88rem" }}>
                  <strong>{fileName}</strong>
                  <div className="muted" style={{ marginTop: 4 }}>{rows.length} ação(ões) para importar, em lotes de 150</div>
                </div>
              )}

              {importing && progress && (
                <div className="card card-pad" style={{ fontSize: "0.9rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <strong>Importando…</strong>
                    <span className="muted">{progress.done} / {progress.total}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, background: "var(--mh-primary)", transition: "width 0.2s" }} />
                  </div>
                  <div className="muted" style={{ fontSize: "0.78rem", marginTop: 6 }}>Não feche esta janela até concluir.</div>
                </div>
              )}

              {summary && (
                <div className="card card-pad" style={{ fontSize: "0.9rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {summary.error && (
                    <span className="badge badge-red" style={{ whiteSpace: "normal", textAlign: "left" }}>{summary.error}</span>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                    <span className="badge badge-green">{summary.created} ação(ões) criada(s)</span>
                    {summary.skipped > 0 && <span className="badge badge-amber">{summary.skipped} linha(s) ignorada(s)</span>}
                    {summary.failed.length > 0 && <span className="badge badge-red">{summary.failed.length} falha(s)</span>}
                  </div>
                  {summary.peopleNotFound.length > 0 && (
                    <div className="muted" style={{ fontSize: "0.82rem" }}>Pessoas não encontradas (ajuste depois): {summary.peopleNotFound.join(", ")}</div>
                  )}
                  {summary.refsNotFound.length > 0 && (
                    <div className="muted" style={{ fontSize: "0.82rem" }}>Cadastros não encontrados: {summary.refsNotFound.join(", ")}</div>
                  )}
                  {summary.failed.length > 0 && (
                    <details style={{ fontSize: "0.8rem" }}>
                      <summary style={{ cursor: "pointer" }} className="muted">Ver linhas que falharam ({summary.failed.length})</summary>
                      <div className="muted" style={{ marginTop: 4, maxHeight: 160, overflowY: "auto", whiteSpace: "pre-wrap" }}>{summary.failed.join("\n")}</div>
                    </details>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
              <button type="button" className="btn btn-ghost" disabled={importing} onClick={close}>{summary ? "Fechar" : "Cancelar"}</button>
              {!summary && (
                <button type="button" className="btn btn-primary" disabled={!rows.length || importing} onClick={doImport}>
                  {importing ? "Importando…" : "Importar"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
