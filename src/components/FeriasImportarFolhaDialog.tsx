"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileSpreadsheet } from "lucide-react";
import { loadXlsx } from "@/lib/xlsx-lazy";
import {
  lerArquivoDeFerias, linhasDoModelo, MODELO_ABA, MODELO_INSTRUCOES, type RelatorioFolha,
} from "@/lib/ferias-folha";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  analisarFolha, dadosDoModeloDeFerias, importarFolha,
  type AnaliseFolha, type PessoaFolhaEnvio, type ResultadoImportacaoFolha,
} from "@/lib/actions/ferias";
import type { UltimaImportacaoFolha } from "@/components/FeriasManager";

/** "hoje" no fuso do Brasil (o mesmo cálculo da página) */
const hojeBrasil = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/**
 * Importação dos períodos aquisitivos de férias.
 *
 * Aceita dois formatos, reconhecidos pelo conteúdo do arquivo: o MODELO do
 * MANAGERHUB (botão "Baixar modelo", serve para qualquer empresa) e o
 * relatório "Programação de Férias" da folha. Três passos na mesma janela:
 * escolher o arquivo (lido no navegador), conferir a prévia (quem entra, quem
 * fica de fora e por quê) e importar. Prévia e gravação resolvem as pessoas no
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
  // só no modelo: até quando os dias gozados estão atualizados
  const [referenciaModelo, setReferenciaModelo] = useState(hojeBrasil);
  const [lendo, iniciarLeitura] = useTransition();
  const [importando, iniciarImportacao] = useTransition();
  const [baixando, iniciarDownload] = useTransition();
  const router = useRouter();
  const hoje = hojeBrasil();

  const envio = (r: RelatorioFolha): PessoaFolhaEnvio[] =>
    r.pessoas.map((p) => ({
      bloco: p.bloco, linha: p.linha, codigo: p.codigo, nome: p.nome, unidade: p.unidade, periodos: p.periodos,
    }));

  const baixarModelo = () => {
    iniciarDownload(async () => {
      const r = await dadosDoModeloDeFerias();
      if (r.error) { toast.error(r.error); return; }
      const XLSX = await loadXlsx();
      const ws = XLSX.utils.aoa_to_sheet(linhasDoModelo(r.pessoas));
      ws["!cols"] = [{ wch: 14 }, { wch: 11 }, { wch: 38 }, { wch: 19 }, { wch: 17 }, { wch: 15 }, { wch: 16 }, { wch: 13 }];
      const wsI = XLSX.utils.aoa_to_sheet(MODELO_INSTRUCOES);
      wsI["!cols"] = [{ wch: 120 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, MODELO_ABA);
      XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
      XLSX.writeFile(wb, "modelo_periodos_aquisitivos_ferias.xlsx");
    });
  };

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
        // o modelo pode ter ganhado abas na mão: a dos dados é a que tem o nome do modelo
        const nomeAba = wb.SheetNames.includes(MODELO_ABA) ? MODELO_ABA : wb.SheetNames[0];
        const ws = wb.Sheets[nomeAba];
        if (!ws) { setErro("A planilha está vazia."); return; }
        // blankrows: a contagem de linhas bate com a do Excel, para a prévia
        // apontar "linha 140" e a pessoa achar
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: true, defval: null });
        const inicio = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).s.r + 1 : 1;
        const lido = lerArquivoDeFerias(aoa, inicio);
        if (lido.erro !== undefined) { setErro(lido.erro); return; }
        setRelatorio(lido.relatorio);
        if (lido.relatorio.pessoas.length === 0) return;
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

  const ehModelo = relatorio?.formato === "modelo";
  // a fronteira: o relatório da folha traz a emissão; no modelo, o DP informa
  const referencia = relatorio ? (ehModelo ? referenciaModelo : relatorio.emissao) : null;
  const referenciaValida = !!referencia && /^\d{4}-\d{2}-\d{2}$/.test(referencia) && referencia <= hoje;
  // arquivo mais velho que o último importado apagaria dias gozados que já
  // foram informados; o banco recusa, e a tela avisa antes
  const maisAntigo = !!(referencia && ultima && referencia < ultima.referencia);

  const importar = () => {
    if (!relatorio || !analise || !referencia) return;
    setErro("");
    iniciarImportacao(async () => {
      const r = await importarFolha({
        pessoas: envio(relatorio),
        unidadePorBloco: analise.unidadePorBloco,
        emissao: referencia,
        dataBase: relatorio.dataBase,
        arquivo,
      });
      if (r.error) { setErro(r.error); return; }
      toast.success(`Períodos de ${r.pessoas} colaborador(es) atualizados.`);
      setResultado(r);
      router.refresh();
    });
  };

  // o que fica de fora: linhas que o leitor recusou e pessoas que o servidor não achou
  const recusadas = [
    ...(relatorio?.naoReconhecidas ?? []).map((l) => ({ linha: l.linha, codigo: "", nome: "", motivo: l.motivo })),
    ...(resultado?.recusadas ?? analise?.recusadas ?? []),
  ].sort((a, b) => a.linha - b.linha);

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
          <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>Importar períodos aquisitivos</h2>
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
                Para cada colaborador do arquivo, o sistema passa a usar os períodos aquisitivos, os
                dias de direito, os dias já gozados e o prazo para gozo informados, e recusa pedidos
                fora disso. Quem não estiver no arquivo continua com o que foi importado antes.
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", fontSize: "0.8rem" }}>
                <span className="soft" style={{ flex: 1, minWidth: 260 }}>
                  Formatos aceitos: o <strong>modelo do MANAGERHUB</strong>, que já vem com os
                  colaboradores ativos, ou o relatório <strong>Programação de Férias</strong> da folha.
                </span>
                <button type="button" className="btn btn-ghost btn-sm" disabled={baixando} onClick={baixarModelo}>
                  <Download size={13} aria-hidden /> {baixando ? "Gerando…" : "Baixar modelo"}
                </button>
              </div>
              {ultima && (
                <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
                  Última importação: dados de {formatDate(ultima.referencia)}, importados
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
                <span style={{ flex: 1 }}>{arquivo || "Escolher o arquivo .xlsx"}</span>
                <span className="btn btn-ghost btn-sm">{arquivo ? "Trocar" : "Escolher"}</span>
                <input
                  type="file" accept=".xlsx,.xls" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) ler(f); e.target.value = ""; }}
                />
              </label>

              {lendo && <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Lendo e conferindo…</p>}
            </>
          )}

          {relatorio && !resultado && (
            <>
              <div style={{ background: "var(--surface-2)", borderRadius: 9, padding: "0.65rem 0.8rem", fontSize: "0.84rem", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                {ehModelo ? (
                  <>
                    <div>Modelo do MANAGERHUB, {relatorio.pessoas.length} colaborador(es) com período preenchido.</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <label htmlFor="ferias-ref-modelo" style={{ fontWeight: 600 }}>Dias gozados atualizados até</label>
                      <input
                        id="ferias-ref-modelo" className="input" type="date" max={hoje}
                        value={referenciaModelo} onChange={(e) => setReferenciaModelo(e.target.value)}
                        style={{ maxWidth: 170, padding: "0.25rem 0.5rem", fontSize: "0.82rem" }}
                      />
                    </div>
                    <p className="soft" style={{ fontSize: "0.74rem", margin: 0 }}>
                      Férias lançadas no sistema que começam depois desta data são descontadas do
                      saldo; as anteriores já precisam estar somadas na coluna Dias já gozados.
                    </p>
                    {!referenciaValida && (
                      <p style={{ color: "var(--mh-danger)", fontSize: "0.78rem", margin: 0 }}>
                        Informe uma data até hoje.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <div>
                      Relatório da folha emitido em <strong>{formatDate(relatorio.emissao!)}</strong>
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
                        {analise?.multiUnidade && (
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
                    {analise?.multiUnidade && (
                      <p className="soft" style={{ fontSize: "0.74rem", margin: 0 }}>
                        O relatório não diz a unidade de cada bloco. A sugestão é a unidade em que as
                        matrículas do bloco foram encontradas; confira antes de importar.
                      </p>
                    )}
                  </>
                )}
              </div>

              <div style={{ fontSize: "0.88rem" }}>
                <strong>{analise?.aImportar ?? 0}</strong> colaborador(es) serão atualizados
                ({analise?.periodos ?? 0} períodos aquisitivos).
                {recusadas.length > 0 && (
                  <>
                    {" "}<strong>{recusadas.length}</strong> linha(s) ficam de fora.{" "}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVerRecusadas((v) => !v)}>
                      {verRecusadas ? "Esconder" : "Ver quais"}
                    </button>
                  </>
                )}
              </div>

              {maisAntigo && (
                <p style={{ color: "var(--mh-danger)", fontSize: "0.82rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
                  {ehModelo
                    ? `A data informada é anterior à da última importação (${formatDate(ultima!.referencia)}). Use os dias gozados atualizados até essa data ou depois.`
                    : `Este relatório foi emitido antes do último importado (${formatDate(ultima!.referencia)}). Importá-lo apagaria dias gozados que a folha já informou. Exporte um relatório atual.`}
                </p>
              )}
            </>
          )}

          {resultado && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", fontSize: "0.86rem" }}>
              <p style={{ margin: 0 }}>
                Pronto: <strong>{resultado.pessoas}</strong> colaborador(es) com {resultado.periodos} períodos
                aquisitivos atualizados.
                {recusadas.length > 0 && ` ${recusadas.length} linha(s) ficaram de fora.`}
                {(resultado.reatribuidas ?? 0) > 0 && ` ${resultado.reatribuidas} previsão(ões) futura(s) passaram para o aquisitivo importado.`}
              </p>
              {(resultado.conflitos ?? []).length > 0 && (
                <div style={{ background: "var(--mh-danger-soft)", borderRadius: 8, padding: "0.55rem 0.75rem" }}>
                  <p style={{ margin: "0 0 0.3rem", fontWeight: 600, color: "var(--mh-danger)" }}>
                    Previsões que não cabem no saldo importado
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
                  {verRecusadas ? "Esconder o que ficou de fora" : "Ver o que ficou de fora"}
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
                    <th style={{ width: 220 }}>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {recusadas.map((r, i) => (
                    <tr key={`${r.linha}-${r.codigo}-${i}`}>
                      <td className="tabular">{r.linha}</td>
                      <td className="tabular">{r.codigo || "—"}</td>
                      <td>{r.nome || "—"}</td>
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
                disabled={!analise || analise.aImportar === 0 || maisAntigo || !referenciaValida || lendo || importando}
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
