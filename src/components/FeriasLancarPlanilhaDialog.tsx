"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { loadXlsx } from "@/lib/xlsx-lazy";
import {
  LOTE_ABA, LOTE_INSTRUCOES, lerPlanilhaDeLancamento, linhasDoModeloLote,
  type LinhaInvalidaLote, type PessoaLote,
} from "@/lib/ferias-lote";
import { formatDate } from "@/lib/format";
import { lancarFeriasEmLote, modeloDeLancamentoEmLote, type ResultadoLote } from "@/lib/actions/ferias";

/** uma linha da tabela de resultado: a pessoa (ou a linha inválida) e o que aconteceu */
type Linha = {
  chave: string;
  linhas: number[];
  codigo: string;
  nome: string;
  periodos: string;
  situacao: "pronto" | "lancado" | "recusado";
  motivo?: string;
};

const resumoPeriodos = (ps: { inicio: string; fim: string; abono: number }[]) =>
  ps.map((p) => `${formatDate(p.inicio)} a ${formatDate(p.fim)}${p.abono ? ` (+${p.abono} abono)` : ""}`).join("; ");

/**
 * Lançamento da programação de férias da equipe por planilha.
 *
 * O modelo vem com quem só o gestor lança e o saldo de cada um. Ao escolher o
 * arquivo, a prévia roda no banco o mesmo lançamento do botão individual e o
 * desfaz: quem está "Pronto" é exatamente quem vai entrar. O envio grava os
 * prontos, já aprovados, e o DP recebe um aviso só.
 *
 * Fecha por X ou Cancelar, nunca por clique no fundo.
 */
export function FeriasLancarPlanilhaDialog({ hoje, onFechar }: { hoje: string; onFechar: () => void }) {
  const [arquivo, setArquivo] = useState("");
  const [pessoas, setPessoas] = useState<PessoaLote[]>([]);
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState("");
  const [lendo, iniciarLeitura] = useTransition();
  const [enviando, iniciarEnvio] = useTransition();
  const [baixando, iniciarDownload] = useTransition();
  const router = useRouter();

  const baixarModelo = () => {
    iniciarDownload(async () => {
      const r = await modeloDeLancamentoEmLote({ hoje });
      if (r.error) { toast.error(r.error); return; }
      if (r.pessoas.length === 0) {
        toast.warning("Ninguém da sua equipe depende de você para lançar férias. O modelo sai vazio para você preencher.");
      }
      const XLSX = await loadXlsx();
      const ws = XLSX.utils.aoa_to_sheet(linhasDoModeloLote(r.pessoas));
      ws["!cols"] = [{ wch: 12 }, { wch: 11 }, { wch: 36 }, { wch: 18 }, { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 17 }, { wch: 18 }, { wch: 13 }, { wch: 13 }];
      const wsI = XLSX.utils.aoa_to_sheet(LOTE_INSTRUCOES);
      wsI["!cols"] = [{ wch: 120 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, LOTE_ABA);
      XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
      XLSX.writeFile(wb, "programacao_de_ferias_da_equipe.xlsx");
    });
  };

  const montar = (invalidas: LinhaInvalidaLote[], resultados: ResultadoLote[], definitivo: boolean): Linha[] => [
    ...invalidas.map((l) => ({
      chave: `i${l.linha}`, linhas: [l.linha], codigo: l.codigo, nome: l.nome, periodos: "",
      situacao: "recusado" as const, motivo: l.motivo,
    })),
    ...resultados.map((r) => ({
      chave: `p${r.linhas.join("-")}`, linhas: r.linhas, codigo: r.codigo, nome: r.nome,
      periodos: resumoPeriodos(r.periodos),
      situacao: r.ok ? (definitivo ? "lancado" as const : "pronto" as const) : "recusado" as const,
      motivo: r.motivo,
    })),
  ].sort((a, b) => a.linhas[0] - b.linhas[0]);

  const ler = (file: File) => {
    setErro("");
    setLinhas(null);
    setEnviado(false);
    setArquivo(file.name);
    iniciarLeitura(async () => {
      try {
        const XLSX = await loadXlsx();
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
        const nomeAba = wb.SheetNames.includes(LOTE_ABA) ? LOTE_ABA : wb.SheetNames[0];
        const ws = wb.Sheets[nomeAba];
        if (!ws) { setErro("A planilha está vazia."); return; }
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: true, defval: null });
        const inicio = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).s.r + 1 : 1;
        const lido = lerPlanilhaDeLancamento(aoa, inicio);
        if (lido.erro !== undefined) { setErro(lido.erro); return; }
        setPessoas(lido.pessoas);
        if (lido.pessoas.length === 0) { setLinhas(montar(lido.invalidas, [], false)); return; }
        const r = await lancarFeriasEmLote({ pessoas: lido.pessoas, hoje, somenteValidar: true });
        if (r.error) { setErro(r.error); return; }
        setLinhas(montar(lido.invalidas, r.resultados, false));
      } catch (e) {
        setErro(`Não foi possível ler o arquivo: ${(e as Error).message}`);
      }
    });
  };

  const prontos = (linhas ?? []).filter((l) => l.situacao === "pronto").length;
  const recusados = (linhas ?? []).filter((l) => l.situacao === "recusado").length;
  const lancados = (linhas ?? []).filter((l) => l.situacao === "lancado").length;

  const enviar = () => {
    // só vão as pessoas que a prévia aprovou; o banco confere tudo de novo
    const prontasIdx = new Set((linhas ?? []).filter((l) => l.situacao === "pronto").map((l) => l.linhas.join("-")));
    const aEnviar = pessoas.filter((p) => prontasIdx.has(p.linhas.join("-")));
    if (aEnviar.length === 0) return;
    setErro("");
    iniciarEnvio(async () => {
      const r = await lancarFeriasEmLote({ pessoas: aEnviar, hoje, somenteValidar: false });
      if (r.error) { setErro(r.error); return; }
      const ok = r.resultados.filter((x) => x.ok).length;
      // as recusadas da prévia continuam na tabela, com o motivo
      const recusadasDaPrevia = (linhas ?? []).filter((l) => l.situacao === "recusado");
      setLinhas([
        ...recusadasDaPrevia,
        ...montar([], r.resultados, true),
      ].sort((a, b) => a.linhas[0] - b.linhas[0]));
      setEnviado(true);
      if (ok > 0) toast.success(`Férias de ${ok} colaborador(es) lançadas. Elas seguem para a efetivação do DP.`);
      router.refresh();
    });
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "5vh 1rem", zIndex: 60, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 760, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>Importar programação de férias</h2>
          <button
            type="button" onClick={onFechar} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "1.15rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          {!enviado && (
            <>
              <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
                Para lançar as férias da equipe de uma vez. Baixe o modelo, que já vem com quem só
                você pode lançar e o saldo de cada um, preencha início e término e importe. Cada
                pessoa passa pelas mesmas regras do botão Lançar férias: a prévia mostra quem está
                pronto e quem foi recusado, com o motivo, antes de gravar.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-ghost btn-sm" disabled={baixando} onClick={baixarModelo}>
                  <Download size={13} aria-hidden /> {baixando ? "Gerando…" : "Baixar modelo"}
                </button>
              </div>
              <label
                style={{
                  display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.8rem 0.9rem",
                  border: "1px dashed var(--border-strong)", borderRadius: 10, cursor: "pointer", fontSize: "0.85rem",
                }}
              >
                <FileSpreadsheet size={18} aria-hidden />
                <span style={{ flex: 1 }}>{arquivo || "Escolher a planilha preenchida (.xlsx)"}</span>
                <span className="btn btn-ghost btn-sm">{arquivo ? "Trocar" : "Escolher"}</span>
                <input
                  type="file" accept=".xlsx,.xls" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) ler(f); e.target.value = ""; }}
                />
              </label>
              {lendo && <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Lendo e conferindo cada pessoa…</p>}
            </>
          )}

          {linhas && (
            <>
              <div style={{ fontSize: "0.88rem" }}>
                {enviado
                  ? <><strong>{lancados}</strong> colaborador(es) lançados. {recusados > 0 && <><strong>{recusados}</strong> recusado(s).</>}</>
                  : <><strong>{prontos}</strong> pronto(s) para lançar. {recusados > 0 && <><strong>{recusados}</strong> recusado(s), veja o motivo abaixo.</>}</>}
              </div>
              <div style={{ maxHeight: 340, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}>Linha</th>
                      <th>Colaborador</th>
                      <th style={{ width: 220 }}>Períodos</th>
                      <th style={{ width: 110 }}>Resultado</th>
                      <th style={{ width: 220 }}>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => (
                      <tr key={l.chave}>
                        <td className="tabular">{l.linhas.join(", ")}</td>
                        <td>{l.nome || l.codigo || "—"}</td>
                        <td className="muted" style={{ fontSize: "0.8rem" }}>{l.periodos || "—"}</td>
                        <td>
                          {l.situacao === "recusado"
                            ? <Badge tone="red">Recusado</Badge>
                            : <Badge tone="green">{l.situacao === "lancado" ? "Lançado" : "Pronto"}</Badge>}
                        </td>
                        <td className="muted" style={{ fontSize: "0.8rem" }}>{l.motivo || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {erro && (
            <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
              {erro}
            </p>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          {enviado ? (
            <button type="button" className="btn btn-primary" onClick={onFechar}>Fechar</button>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
              <button type="button" className="btn btn-primary" disabled={prontos === 0 || lendo || enviando} onClick={enviar}>
                {enviando ? "Lançando…" : `Lançar ${prontos} colaborador(es)`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
