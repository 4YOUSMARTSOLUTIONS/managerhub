"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileSpreadsheet } from "lucide-react";
import { loadXlsx } from "@/lib/xlsx-lazy";
import { lerProgramacaoDeFerias, type RelatorioFolha } from "@/lib/ferias-folha";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  analisarFolha, importarFolha,
  type AnaliseFolha, type PessoaFolhaEnvio, type ResultadoImportacaoFolha,
} from "@/lib/actions/ferias";
import type { UltimaImportacaoFolha } from "@/components/FeriasManager";

/**
 * Importação do relatório "Programação de Férias" da folha.
 *
 * Três passos na mesma janela: escolher o arquivo (lido no navegador), conferir
 * a prévia (quem entra, quem fica de fora e por quê, e a unidade de cada bloco
 * do relatório) e importar. A prévia e a gravação resolvem as pessoas no
 * servidor, pela mesma regra de unidade + matrícula das outras importações.
 *
 * Fecha por X ou Cancelar, nunca por clique no fundo.
 */
export function FeriasImportarFolhaDialog({
  ultima, onFechar,
}: {
  ultima: UltimaImportacaoFolha | null;
  onFechar: () => void;
}) {
  const [arquivo, setArquivo] = useState("");
  const [relatorio, setRelatorio] = useState<RelatorioFolha | null>(null);
  const [analise, setAnalise] = useState<AnaliseFolha | null>(null);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<ResultadoImportacaoFolha | null>(null);
  const [verRecusadas, setVerRecusadas] = useState(false);
  const [lendo, iniciarLeitura] = useTransition();
  const [importando, iniciarImportacao] = useTransition();
  const router = useRouter();

  const envio = (r: RelatorioFolha): PessoaFolhaEnvio[] =>
    r.pessoas.map((p) => ({ bloco: p.bloco, linha: p.linha, codigo: p.codigo, nome: p.nome, periodos: p.periodos }));

  const ler = (file: File) => {
    setErro("");
    setRelatorio(null);
    setAnalise(null);
    setResultado(null);
    setArquivo(file.name);
    iniciarLeitura(async () => {
      try {
        const XLSX = await loadXlsx();
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) { setErro("A planilha está vazia."); return; }
        // blankrows: a contagem de linhas bate com a do Excel, para a prévia
        // apontar "linha 140" e a pessoa achar
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: true, defval: null });
        const inicio = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).s.r + 1 : 1;
        const lido = lerProgramacaoDeFerias(aoa, inicio);
        if (lido.erro !== undefined) { setErro(lido.erro); return; }
        setRelatorio(lido.relatorio);
        const a = await analisarFolha({ pessoas: envio(lido.relatorio) });
        if (a.error) { setErro(a.error); return; }
        setAnalise(a);
      } catch (e) {
        setErro(`Não foi possível ler o arquivo: ${(e as Error).message}`);
      }
    });
  };

  const trocarUnidade = (bloco: number, unidade: string) => {
    if (!relatorio || !analise) return;
    const unidadePorBloco = { ...analise.unidadePorBloco, [String(bloco)]: unidade };
    iniciarLeitura(async () => {
      const a = await analisarFolha({ pessoas: envio(relatorio), unidadePorBloco });
      if (a.error) { setErro(a.error); return; }
      setAnalise(a);
    });
  };

  // relatório mais velho que o último importado apagaria dias gozados que a
  // folha já conhece; o banco recusa, e a tela avisa antes
  const maisAntigo = !!(relatorio && ultima && relatorio.emissao < ultima.referencia);

  const importar = () => {
    if (!relatorio || !analise) return;
    setErro("");
    iniciarImportacao(async () => {
      const r = await importarFolha({
        pessoas: envio(relatorio),
        unidadePorBloco: analise.unidadePorBloco,
        emissao: relatorio.emissao,
        dataBase: relatorio.dataBase,
        arquivo,
      });
      if (r.error) { setErro(r.error); return; }
      toast.success(`Períodos de ${r.pessoas} colaborador(es) atualizados pela folha.`);
      setResultado(r);
      router.refresh();
    });
  };

  const recusadas = resultado?.recusadas ?? analise?.recusadas ?? [];

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "5vh 1rem", zIndex: 60, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 680, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>Importar períodos aquisitivos da folha</h2>
          <button
            type="button" onClick={onFechar} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "1.15rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          {!resultado && (
            <>
              <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
                Use o relatório <strong>Programação de Férias</strong> exportado da folha em Excel.
                Para cada colaborador do relatório, o sistema passa a usar os períodos aquisitivos,
                os dias de direito, os dias já gozados e o prazo para gozo que a folha informa, e
                recusa pedidos fora disso. Quem não estiver no relatório continua com o que foi
                importado antes.
              </p>
              {ultima && (
                <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
                  Último relatório importado: emitido em {formatDate(ultima.referencia)}, importado
                  em {formatDateTime(ultima.importadoEm)}, {ultima.pessoas} colaboradores.
                </p>
              )}

              <label
                style={{
                  display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.8rem 0.9rem",
                  border: "1px dashed var(--border-strong)", borderRadius: 10, cursor: "pointer", fontSize: "0.85rem",
                }}
              >
                <FileSpreadsheet size={18} aria-hidden />
                <span style={{ flex: 1 }}>{arquivo || "Escolher o arquivo .xlsx do relatório"}</span>
                <span className="btn btn-ghost btn-sm">{arquivo ? "Trocar" : "Escolher"}</span>
                <input
                  type="file" accept=".xlsx,.xls" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) ler(f); e.target.value = ""; }}
                />
              </label>

              {lendo && <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Lendo e conferindo…</p>}
            </>
          )}

          {relatorio && analise && !resultado && (
            <>
              <div style={{ background: "var(--surface-2)", borderRadius: 9, padding: "0.65rem 0.8rem", fontSize: "0.84rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <div>
                  Relatório emitido em <strong>{formatDate(relatorio.emissao)}</strong>
                  {relatorio.dataBase && <> · data base {formatDate(relatorio.dataBase)}</>}
                </div>
                {relatorio.blocos.map((b) => (
                  <div key={b.numero} style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span>
                      Bloco {b.numero}: {b.pessoas} colaborador(es)
                      {b.totalInformado !== null && b.totalInformado !== b.pessoas && (
                        <span style={{ color: "var(--mh-danger)" }}> (o relatório informa {b.totalInformado})</span>
                      )}
                    </span>
                    {analise.multiUnidade && (
                      <select
                        className="input"
                        value={analise.unidadePorBloco[String(b.numero)] ?? ""}
                        onChange={(e) => trocarUnidade(b.numero, e.target.value)}
                        disabled={lendo || importando}
                        style={{ maxWidth: 200, padding: "0.25rem 0.5rem", fontSize: "0.82rem", marginLeft: "auto" }}
                        aria-label={`Unidade do bloco ${b.numero}`}
                      >
                        {analise.unidades.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    )}
                  </div>
                ))}
                {analise.multiUnidade && (
                  <p className="soft" style={{ fontSize: "0.74rem", margin: 0 }}>
                    O relatório não diz a unidade de cada bloco. A sugestão é a unidade em que as
                    matrículas do bloco foram encontradas; confira antes de importar.
                  </p>
                )}
                {relatorio.naoReconhecidas.length > 0 && (
                  <p style={{ color: "var(--mh-danger)", fontSize: "0.78rem", margin: 0 }}>
                    {relatorio.naoReconhecidas.length} linha(s) com dados que não foi possível ler:{" "}
                    {relatorio.naoReconhecidas.slice(0, 10).join(", ")}
                    {relatorio.naoReconhecidas.length > 10 ? "…" : ""}.
                  </p>
                )}
              </div>

              <div style={{ fontSize: "0.88rem" }}>
                <strong>{analise.aImportar}</strong> colaborador(es) serão atualizados
                ({analise.periodos} períodos aquisitivos).
                {recusadas.length > 0 && (
                  <>
                    {" "}<strong>{recusadas.length}</strong> ficam de fora.{" "}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVerRecusadas((v) => !v)}>
                      {verRecusadas ? "Esconder" : "Ver quem"}
                    </button>
                  </>
                )}
              </div>

              {maisAntigo && (
                <p style={{ color: "var(--mh-danger)", fontSize: "0.82rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
                  Este relatório foi emitido antes do último importado ({formatDate(ultima!.referencia)}).
                  Importá-lo apagaria dias gozados que a folha já informou. Exporte um relatório atual.
                </p>
              )}
            </>
          )}

          {resultado && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", fontSize: "0.86rem" }}>
              <p style={{ margin: 0 }}>
                Pronto: <strong>{resultado.pessoas}</strong> colaborador(es) com {resultado.periodos} períodos
                aquisitivos atualizados pela folha.
                {recusadas.length > 0 && ` ${recusadas.length} ficaram de fora.`}
                {(resultado.reatribuidas ?? 0) > 0 && ` ${resultado.reatribuidas} previsão(ões) futura(s) passaram para o aquisitivo da folha.`}
              </p>
              {(resultado.conflitos ?? []).length > 0 && (
                <div style={{ background: "var(--mh-danger-soft)", borderRadius: 8, padding: "0.55rem 0.75rem" }}>
                  <p style={{ margin: "0 0 0.3rem", fontWeight: 600, color: "var(--mh-danger)" }}>
                    Previsões que não cabem no saldo da folha
                  </p>
                  <p className="soft" style={{ margin: "0 0 0.3rem", fontSize: "0.78rem" }}>
                    Elas continuam ocupando o saldo, mas a efetivação vai recusá-las. Devolva ou cancele cada uma.
                  </p>
                  {(resultado.conflitos ?? []).map((c) => (
                    <div key={c.id} style={{ fontSize: "0.8rem" }}>
                      {c.nome}: {formatDate(c.inicio)} a {formatDate(c.fim)}
                    </div>
                  ))}
                </div>
              )}
              {recusadas.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setVerRecusadas((v) => !v)}>
                  {verRecusadas ? "Esconder quem ficou de fora" : "Ver quem ficou de fora"}
                </button>
              )}
            </div>
          )}

          {verRecusadas && recusadas.length > 0 && (
            <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 64 }}>Linha</th>
                    <th style={{ width: 90 }}>Matrícula</th>
                    <th>Nome</th>
                    <th style={{ width: 200 }}>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {recusadas.map((r) => (
                    <tr key={`${r.linha}-${r.codigo}`}>
                      <td className="tabular">{r.linha}</td>
                      <td className="tabular">{r.codigo}</td>
                      <td>{r.nome}</td>
                      <td className="muted" style={{ fontSize: "0.82rem" }}>{r.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {erro && (
            <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
              {erro}
            </p>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          {resultado ? (
            <button type="button" className="btn btn-primary" onClick={onFechar}>Fechar</button>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
              <button
                type="button" className="btn btn-primary"
                disabled={!analise || analise.aImportar === 0 || maisAntigo || lendo || importando}
                onClick={importar}
              >
                {importando ? "Importando…" : analise ? `Importar ${analise.aImportar} colaborador(es)` : "Importar"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
