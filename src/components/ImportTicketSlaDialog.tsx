"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { loadXlsx } from "@/lib/xlsx-lazy";
import { importTicketSlas, type TicketSlaRow, type TicketSlaImportResult } from "@/lib/actions/tickets";
import { IconImport } from "@/components/ui/ImpExpIcons";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export function ImportTicketSlaDialog({ open: openProp, onClose, hideTrigger }: { open?: boolean; onClose?: () => void; hideTrigger?: boolean } = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const [rows, setRows] = useState<TicketSlaRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<TicketSlaImportResult | null>(null);
  const router = useRouter();

  function reset() { setRows([]); setFileName(""); setParseError(""); setSummary(null); }
  function close() { if (controlled) onClose?.(); else setInternalOpen(false); reset(); }

  async function downloadTemplate() {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Setor", "Categoria", "Prioridade", "Valor", "Unidade"],
      ["TI", "Acesso", "Alta", "4", "horas"],
      ["TI", "Acesso", "Média", "1", "dias úteis"],
      ["TI", "Backup", "", "2", "dias úteis"],
      ["Serviços Gerais", "Limpeza", "", "1", "dias corridos"],
    ]);
    ws["!cols"] = [{ wch: 22 }, { wch: 26 }, { wch: 14 }, { wch: 10 }, { wch: 16 }];
    const wsI = XLSX.utils.aoa_to_sheet([
      ["Coluna", "Como preencher"],
      ["Setor", "Nome do setor. Criado se não existir."],
      ["Categoria", "Nome da categoria, dentro do setor. Criada se não existir."],
      ["Prioridade", "Baixa, Média, Alta ou Urgente. Deixe VAZIO para SLA único por categoria (modo simples)."],
      ["Valor", "Número inteiro do prazo (ex.: 4)."],
      ["Unidade", "horas, dias corridos ou dias úteis (vazio = dias úteis)."],
      ["Observação", "No modo 'Por prioridade', preencha a Prioridade. No modo 'Somente por categoria', deixe a Prioridade vazia."],
    ]);
    wsI["!cols"] = [{ wch: 14 }, { wch: 92 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SLA");
    XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
    XLSX.writeFile(wb, "modelo_sla_chamados.xlsx");
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
      const idx = {
        setor: find("setor"),
        categoria: find("categoria"),
        prioridade: find("prioridade"),
        valor: find("valor", "prazo", "sla"),
        unidade: find("unidade"),
      };
      if (idx.categoria === -1) { setParseError("Não encontrei a coluna Categoria. Baixe o modelo."); return; }

      const str = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
      const parsed: TicketSlaRow[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i] as unknown[];
        const setor = str(r, idx.setor);
        const categoria = str(r, idx.categoria);
        const valor = str(r, idx.valor);
        if (!setor && !categoria && !valor) continue;
        parsed.push({ setor, categoria, prioridade: str(r, idx.prioridade), valor, unidade: str(r, idx.unidade) });
      }
      if (parsed.length === 0) { setParseError("Nenhuma linha preenchida encontrada."); return; }
      setRows(parsed); setFileName(file.name);
    } catch (e) {
      setParseError("Não consegui ler o arquivo: " + (e as Error).message);
    }
  }

  async function doImport() {
    setImporting(true);
    const res = await importTicketSlas(rows);
    setImporting(false);
    if (res.error) { setSummary(res); return; }
    const parts = [`${res.slasSet} SLA(s)`];
    if (res.skipped > 0) parts.push(`${res.skipped} ignorada(s)`);
    toast.success(`Importação concluída: ${parts.join(", ")}.`);
    router.refresh();
    close();
  }

  return (
    <>
      {!hideTrigger && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInternalOpen(true)}><IconImport /> Importar SLA em lote</button>}
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
          <div className="card" style={{ width: "100%", maxWidth: 540, boxShadow: "var(--mh-shadow-e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Importar SLA de chamados (.xlsx)</h2>
              <button type="button" onClick={close} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
            </div>

            <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
                Colunas Setor, Categoria, Prioridade, Valor e Unidade. Deixe a Prioridade vazia para SLA único por categoria (modo simples). Setores/categorias que não existirem são criados.
              </p>
              <div><button type="button" className="btn btn-ghost btn-sm" onClick={downloadTemplate}>↓ Baixar modelo</button></div>
              <div>
                <label className="label">Arquivo</label>
                <input type="file" accept=".xlsx,.xls,.csv" className="input" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              </div>

              {parseError && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{parseError}</p>}

              {fileName && !summary && (
                <div className="card card-pad" style={{ fontSize: "0.88rem" }}>
                  <strong>{fileName}</strong>
                  <div className="muted" style={{ marginTop: 4 }}>{rows.length} linha(s) para importar</div>
                </div>
              )}

              {summary && summary.error && (
                <div className="card card-pad"><span className="badge badge-red">{summary.error}</span></div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
              <button type="button" className="btn btn-ghost" onClick={close}>Cancelar</button>
              <button type="button" className="btn btn-primary" disabled={!rows.length || importing} onClick={doImport}>
                {importing ? "Importando…" : "Importar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
