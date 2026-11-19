"use client";

import { useState } from "react";
import { toast } from "sonner";
import { DetailModal } from "@/components/ui/DetailModal";
import { useLeituraDePlanilha, AvisoLendoPlanilha } from "@/components/ui/LeituraDePlanilha";
import { confirmDialog } from "@/components/ui/confirm";
import { loadXlsx } from "@/lib/xlsx-lazy";
import { shortName } from "@/lib/format";
import { dataDaCelula } from "@/lib/absenteismo-historico";
import {
  COLUNAS_COMUNICADOS, cpfDaCelula, mapearColunasComunicados, type LinhaComunicado,
} from "@/lib/absenteismo-comunicados";
import { dadosDoModeloHistorico } from "@/lib/actions/absenteismo-historico";
import {
  importarComunicadosAbsenteismo, type RecusaComunicado, type ResultadoComunicados,
} from "@/lib/actions/absenteismo-comunicados";

/**
 * Importação de COMUNICADOS de absenteísmo (LUIZ, 17/11/2026). Só o proprietário.
 *
 * Para os dias de ausência anteriores ao sistema que ainda esperam motivo e
 * atestado. Cada linha entra EM ABERTO, no nome do gestor atual da pessoa (ele
 * efetiva e recebe o lembrete), sem e-mail e sem aviso no sino.
 *
 * A prévia é a própria importação em modo simulação (faz tudo e desfaz): mostra
 * quem o cadastro achou, com quem cada lançamento fica e o que ficou de fora.
 */
export function ImportarComunicadosAbsenteismo({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const { lendo, ler } = useLeituraDePlanilha();
  const [linhas, setLinhas] = useState<LinhaComunicado[]>([]);
  const [ignoradas, setIgnoradas] = useState(0);
  const [arquivo, setArquivo] = useState("");
  const [erro, setErro] = useState("");
  const [previa, setPrevia] = useState<ResultadoComunicados | null>(null);
  const [resultado, setResultado] = useState<ResultadoComunicados | null>(null);
  const [ocupado, setOcupado] = useState<"" | "modelo" | "previa" | "importando">("");

  function limpar() {
    setLinhas([]); setIgnoradas(0); setArquivo(""); setErro(""); setPrevia(null); setResultado(null);
  }
  function fechar() {
    if (ocupado === "importando") return;
    limpar();
    onFechar();
  }

  async function baixarModelo() {
    setOcupado("modelo");
    setErro("");
    try {
      const dados = await dadosDoModeloHistorico();
      if (dados.error) { setErro(dados.error); return; }
      const XLSX = await loadXlsx();
      const larguras = COLUNAS_COMUNICADOS.map((c) => ({ wch: Math.max(14, c.length + 2) }));

      // a aba lida (a primeira) sai só com o cabeçalho: exemplo nela entraria junto
      const ws = XLSX.utils.aoa_to_sheet([[...COLUNAS_COMUNICADOS]]);
      ws["!cols"] = larguras;

      const exemplo = dados.pessoas.find((p) => p.situacao === "Ativo") ?? dados.pessoas[0];
      const wsEx = XLSX.utils.aoa_to_sheet([
        [...COLUNAS_COMUNICADOS],
        ["000.000.000-00", "", "", "Fulano de Tal (pelo CPF)", "03/11/2026", ""],
        ["", exemplo?.code ?? "123", exemplo?.units.split("; ")[0] ?? "", `${exemplo?.name ?? "Ciclano"} (pelo ID)`, "04/11/2026", "Avisou que foi ao médico"],
      ]);
      wsEx["!cols"] = larguras;

      const wsC = XLSX.utils.aoa_to_sheet([
        ["ID", "Unidade", "Colaborador", "Situação"],
        ...dados.pessoas.map((p) => [p.code, p.units, p.name, p.situacao]),
      ]);
      wsC["!cols"] = [{ wch: 12 }, { wch: 18 }, { wch: 38 }, { wch: 18 }];

      const wsI = XLSX.utils.aoa_to_sheet([
        ["Coluna", "Obrigatório", "Como preencher"],
        ["CPF", "CPF ou ID", "O CPF do colaborador, com ou sem pontos. É o que identifica a pessoa. Preenchido, o ID e a Unidade não são usados."],
        ["ID", "CPF ou ID", "Sem CPF: a matrícula do colaborador, como no cadastro (copie da aba Colaboradores), junto com a Unidade."],
        ["Unidade", dados.multiUnidade ? "Com o ID" : "Não", dados.multiUnidade
          ? "Obrigatória quando a pessoa vem pelo ID: a mesma matrícula pode existir em unidades diferentes. Também aceita a coluna Matriz/Filial."
          : "A empresa tem uma única unidade; pode deixar em branco."],
        ["Colaborador", "Não", "Só para conferência. O nome NÃO identifica a pessoa."],
        ["Data", "Sim", "O dia em que a pessoa não compareceu, DD/MM/AAAA. Precisa ser antes de hoje: o que acontece de hoje em diante segue pelo Lançar ausência."],
        ["Observação", "Não", "O que se sabe até agora (o mesmo campo do Lançar ausência)."],
        ["", "", ""],
        ["Como entra", "", "Cada linha entra EM ABERTO, como o \"Ainda não sei o motivo\": sem e-mail e sem aviso no sino. Depois segue o fluxo normal, pelo Efetivar (motivo e atestado) e o envio ao DP, que aí dispara o e-mail."],
        ["Com quem fica", "", "No nome do gestor atual de cada colaborador: ele efetiva e recebe o lembrete diário das 08:00. Quem não tem gestor ativo fica com quem importou. O DP efetiva qualquer um. Na lista, Lançado por mostra Importação."],
        ["Linhas recusadas", "", "Ficam de fora, com o motivo: CPF ou ID não encontrado, data de hoje em diante, antes da admissão, depois do desligamento, dia que já tem absenteísmo (inclusive em outra linha da planilha) ou que cai em férias ou afastamento. Antes de importar, a tela mostra quais e por quê."],
        ["Reimportar a mesma planilha", "", "Não duplica: o que já entrou volta como recusado."],
        ["Desfazer", "", "Um comunicado importado errado se desfaz pelo Cancelar, na lista ou na ficha."],
        ["Outras colunas", "", "Colunas como Setor são ignoradas. A planilha do DP com CPF, Colaborador, Setor, Matriz/Filial e Data é aceita como está."],
      ]);
      wsI["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 110 }];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Comunicados");
      XLSX.utils.book_append_sheet(wb, wsEx, "Exemplos");
      XLSX.utils.book_append_sheet(wb, wsC, "Colaboradores");
      XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
      XLSX.writeFile(wb, "modelo_comunicados_absenteismo.xlsx");
    } catch (e) {
      setErro("Não consegui montar o modelo: " + (e as Error).message);
    } finally {
      setOcupado("");
    }
  }

  async function lerArquivo(file: File) {
    limpar();
    const XLSX = await loadXlsx();
    const lidas: LinhaComunicado[] = [];
    let semNada = 0;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false });
      if (aoa.length < 2) { setErro("A primeira aba da planilha está vazia."); return; }
      const col = mapearColunasComunicados(aoa[0] as unknown[]);
      if (col.cpf < 0 && col.code < 0) { setErro("Não achei a coluna CPF nem a coluna ID na primeira aba. Use o modelo."); return; }
      if (col.data < 0) { setErro("Não achei a coluna Data na primeira aba. Use o modelo."); return; }
      const txt = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
      for (let i = 1; i < aoa.length; i++) {
        const r = (aoa[i] ?? []) as unknown[];
        const cpf = col.cpf >= 0 ? cpfDaCelula(r[col.cpf]) : "";
        if (!cpf && !txt(r, col.code) && !txt(r, col.name) && !txt(r, col.data)) { semNada++; continue; }
        lidas.push({
          linha: i + 1,
          cpf,
          code: txt(r, col.code),
          unit: txt(r, col.unit),
          name: txt(r, col.name),
          data: dataDaCelula(r[col.data]),
          obs: txt(r, col.obs),
        });
      }
    } catch (e) {
      setErro("Não consegui ler o arquivo: " + (e as Error).message);
      return;
    }
    if (lidas.length === 0) { setErro("Nenhuma linha preenchida na primeira aba."); return; }
    if (lidas.length > 2000) { setErro("No máximo 2.000 linhas por importação. Divida a planilha."); return; }

    setLinhas(lidas);
    setIgnoradas(semNada);
    setArquivo(file.name);
    setOcupado("previa");
    try {
      const r = await importarComunicadosAbsenteismo(lidas, true);
      if (r.error) setErro(r.error);
      else setPrevia(r);
    } finally {
      setOcupado("");
    }
  }

  async function importar() {
    if (!previa || previa.importadas === 0) return;
    const ok = await confirmDialog({
      title: "Importar comunicados",
      confirmLabel: `Importar ${previa.importadas}`,
      message: `Importar ${previa.importadas} comunicado(s)? Cada um entra em aberto, no nome do gestor do colaborador, sem e-mail e sem aviso. O gestor efetiva com o motivo e o atestado, e recebe o lembrete diário até lá.`,
    });
    if (!ok) return;
    setOcupado("importando");
    setErro("");
    try {
      const r = await importarComunicadosAbsenteismo(linhas, false);
      if (r.error) { setErro(r.error); return; }
      setResultado(r);
      if (r.importadas > 0) {
        toast.success(`${r.importadas} comunicado(s) importado(s).`);
      }
    } finally {
      setOcupado("");
    }
  }

  async function baixarRecusadas(itens: RecusaComunicado[]) {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Linha", "Colaborador", "Data", "Por que ficou de fora"],
      ...itens.map((i) => [i.linha, i.name, i.data, i.motivo]),
    ]);
    ws["!cols"] = [{ wch: 7 }, { wch: 38 }, { wch: 12 }, { wch: 80 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fora da importação");
    XLSX.writeFile(wb, "comunicados_absenteismo_fora_da_importacao.xlsx");
  }

  const mostrado = resultado ?? previa;
  const terminou = !!resultado;

  return (
    <DetailModal
      open={aberto}
      onClose={fechar}
      title="Importar comunicados de absenteísmo"
      width="md"
      footer={(
        <>
          <span />
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button type="button" className="btn btn-ghost" onClick={fechar} disabled={ocupado === "importando"}>
              {terminou ? "Fechar" : "Cancelar"}
            </button>
            {!terminou && (
              <button
                type="button" className="btn btn-primary" onClick={importar}
                disabled={!previa || previa.importadas === 0 || ocupado !== ""}
              >
                {ocupado === "importando" ? "Importando…" : `Importar ${previa?.importadas || ""}`}
              </button>
            )}
          </div>
        </>
      )}
    >
      <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>
        Para os dias de ausência anteriores ao sistema que ainda esperam o motivo e o atestado. Cada
        linha entra <strong>em aberto</strong>, no nome do gestor do colaborador, sem e-mail e sem
        aviso. Depois segue pelo Efetivar, como qualquer comunicado.
      </p>

      <div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={baixarModelo} disabled={ocupado !== ""}>
          {ocupado === "modelo" ? "Montando o modelo…" : "↓ Baixar modelo"}
        </button>
      </div>

      <div>
        <label className="label" htmlFor="comunicados-absenteismo-arquivo">Planilha preenchida</label>
        <input
          id="comunicados-absenteismo-arquivo" type="file" accept=".xlsx,.xls" className="input"
          disabled={lendo || ocupado !== "" || terminou}
          // limpa o value: sem isso, reescolher o MESMO arquivo não dispara o onChange
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void ler(() => lerArquivo(f)); }}
        />
        <AvisoLendoPlanilha lendo={lendo} />
        {ocupado === "previa" && (
          <p role="status" className="soft" style={{ fontSize: "0.85rem", margin: "0.5rem 0 0" }}>
            Conferindo as {linhas.length} linha(s) com o cadastro…
          </p>
        )}
      </div>

      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}

      {mostrado && (
        <div className="card card-pad" style={{ fontSize: "0.88rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <strong>{arquivo}</strong>
          <div>
            {terminou
              ? <>{mostrado.importadas} comunicado(s) importado(s)</>
              : <>{mostrado.importadas} pronto(s) para importar</>}
            <span className="soft">
              {" · "}{linhas.length} linha(s) lida(s)
              {ignoradas > 0 && ` · ${ignoradas} em branco ignorada(s)`}
            </span>
          </div>

          {mostrado.entradas.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              {/* uma linha por pessoa, como a lista do módulo (LUIZ, 17/11/2026) */}
              <table className="table table-linha">
                <thead>
                  <tr>
                    <th>Linha</th>
                    <th>Matrícula</th>
                    <th>Colaborador no cadastro</th>
                    <th>Data</th>
                    <th>Fica com</th>
                  </tr>
                </thead>
                <tbody>
                  {mostrado.entradas.map((e) => (
                    <tr key={e.linha}>
                      <td className="tabular muted">{e.linha}</td>
                      <td className="tabular muted">{e.matricula ?? "–"}</td>
                      <td>
                        <span className="cell-trunc" style={{ maxWidth: 170 }} title={e.nome}>{shortName(e.nome)}</span>
                      </td>
                      <td className="tabular">{e.data}</td>
                      <td>
                        <span
                          className="cell-trunc" style={{ maxWidth: 220 }}
                          title={e.semGestor ? `${e.responsavel}: sem gestor ativo, fica com quem importou` : e.responsavel}
                        >
                          {shortName(e.responsavel)}
                          {e.semGestor && <span className="soft"> · sem gestor ativo</span>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {mostrado.recusadas.length === 0 ? (
            <p className="soft" style={{ margin: 0, fontSize: "0.8rem" }}>
              {terminou ? "Nenhuma linha ficou de fora." : "Todas as linhas estão prontas para importar."}
            </p>
          ) : (
            <>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--mh-danger)" }}>
                {mostrado.recusadas.length} linha(s) {terminou ? "ficaram" : "ficam"} de fora:
              </div>
              <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.8rem", maxHeight: 220, overflow: "auto" }}>
                {mostrado.recusadas.slice(0, 80).map((i) => (
                  <li key={i.linha} style={{ marginBottom: "0.2rem" }}>
                    <span className="muted">
                      Linha {i.linha}{i.name ? ` · ${i.name}` : ""}{i.data ? ` · ${i.data}` : ""}
                    </span>
                    <div>{i.motivo}</div>
                  </li>
                ))}
                {mostrado.recusadas.length > 80 && (
                  <li className="soft">E mais {mostrado.recusadas.length - 80}. Baixe a lista para ver todas.</li>
                )}
              </ul>
              <div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void baixarRecusadas(mostrado.recusadas)}>
                  ↓ Baixar as {mostrado.recusadas.length} linha(s) de fora
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </DetailModal>
  );
}
