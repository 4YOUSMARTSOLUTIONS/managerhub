"use client";

import { useState } from "react";
import { toast } from "sonner";
import { DetailModal } from "@/components/ui/DetailModal";
import { IconImport } from "@/components/ui/ImpExpIcons";
import { useLeituraDePlanilha, AvisoLendoPlanilha } from "@/components/ui/LeituraDePlanilha";
import { confirmDialog } from "@/components/ui/confirm";
import { loadXlsx } from "@/lib/xlsx-lazy";
import { ABSENCE_KIND_LABEL } from "@/lib/constants";
import {
  COLUNAS_HISTORICO, dataDaCelula, horaDaCelula, mapearColunas, type LinhaHistorico,
} from "@/lib/absenteismo-historico";
import {
  dadosDoModeloHistorico, importarHistoricoAbsenteismo,
  type RecusaHistorico, type ResultadoHistorico,
} from "@/lib/actions/absenteismo-historico";

/**
 * Importação do HISTÓRICO de absenteísmo (LUIZ, 16/11/2026). Só o proprietário.
 *
 * Serve para carregar o passado; o dia a dia segue pelo "Lançar ausência". Cada
 * linha entra aprovada, sem comunicado, sem aviso e sem anexo.
 *
 * A prévia não é uma conferência própria da tela: ela chama a MESMA importação
 * no servidor em modo simulação (faz tudo e desfaz). Assim o "ficam de fora"
 * inclui o que só o banco sabe, como o período que cruza com férias.
 */
export function ImportarHistoricoAbsenteismo({ aberto: abertoDeFora, onFechar }: {
  /** aberto pelo menu Planilhas: sem botão próprio */
  aberto?: boolean;
  onFechar?: () => void;
} = {}) {
  const controlado = abertoDeFora !== undefined;
  const [abertoAqui, setAbertoAqui] = useState(false);
  const aberto = controlado ? abertoDeFora : abertoAqui;
  const setAberto = (v: boolean) => {
    if (controlado) { if (!v) onFechar?.(); }
    else setAbertoAqui(v);
  };
  const { lendo, ler } = useLeituraDePlanilha();
  const [linhas, setLinhas] = useState<LinhaHistorico[]>([]);
  const [ignoradas, setIgnoradas] = useState(0);
  const [arquivo, setArquivo] = useState("");
  const [erro, setErro] = useState("");
  const [previa, setPrevia] = useState<ResultadoHistorico | null>(null);
  const [resultado, setResultado] = useState<ResultadoHistorico | null>(null);
  const [ocupado, setOcupado] = useState<"" | "modelo" | "previa" | "importando">("");

  function limpar() {
    setLinhas([]); setIgnoradas(0); setArquivo(""); setErro(""); setPrevia(null); setResultado(null);
  }
  function fechar() {
    if (ocupado === "importando") return;
    setAberto(false);
    limpar();
  }

  async function baixarModelo() {
    setOcupado("modelo");
    setErro("");
    try {
      const dados = await dadosDoModeloHistorico();
      if (dados.error) { setErro(dados.error); return; }
      const XLSX = await loadXlsx();
      const exemplo = dados.pessoas.find((p) => p.situacao === "Ativo") ?? dados.pessoas[0];
      const id = exemplo?.code ?? "123";
      const un = exemplo?.units.split("; ")[0] ?? "";
      const nome = exemplo?.name ?? "Fulano de Tal";

      // A aba que é lida (a primeira) sai SÓ com o cabeçalho: exemplo nela
      // acabaria importado junto, com o nome de uma pessoa de verdade.
      const ws = XLSX.utils.aoa_to_sheet([[...COLUNAS_HISTORICO]]);
      ws["!cols"] = COLUNAS_HISTORICO.map((c) => ({ wch: Math.max(12, c.length + 2) }));

      const wsEx = XLSX.utils.aoa_to_sheet([
        [...COLUNAS_HISTORICO],
        [id, un, nome, "Atestado", "", "03/03/2026", "05/03/2026", "", "", "", "Médico", "M54.5", "Dra. Maria Souza", "CRM-MG 12345", "UPA Centro", "03/03/2026", "", "", "Não", ""],
        [id, un, nome, "Falta sem justificativa", "", "14/04/2026", "14/04/2026", "", "", "", "", "", "", "", "", "", "", "", "", "Não"],
        [id, un, nome, "Falta sem justificativa", "", "20/05/2026", "20/05/2026", "08:00", "10:30", "Chegou atrasado", "", "", "", "", "", "", "", "", "", "Não"],
        [id, un, nome, "Licença nojo (falecimento)", "", "02/06/2026", "03/06/2026", "", "", "", "", "", "", "", "", "", "", "Avô", "", ""],
        [id, un, nome, "Afastamento", "Afastado pelo INSS", "10/07/2026", "06/01/2027", "", "", "", "", "M51", "Dr. João Lima", "CRM-MG 54321", "Hospital Central", "", "", "", "", ""],
      ]);
      wsEx["!cols"] = COLUNAS_HISTORICO.map((c) => ({ wch: Math.max(12, c.length + 2) }));

      const wsM = XLSX.utils.aoa_to_sheet([
        ["Motivo (escreva igual)", "Comportamento", "Usa dados do atestado", "Usa acompanhado", "Usa parentesco", "Situação"],
        ...dados.motivos.map((m) => [
          m.name, ABSENCE_KIND_LABEL[m.kind], m.requiresMedical ? "Sim" : "", m.requiresCompanion ? "Sim" : "",
          m.requiresKinship ? "Sim" : "", m.active ? "Ativo" : "Inativo",
        ]),
      ]);
      wsM["!cols"] = [{ wch: 34 }, { wch: 16 }, { wch: 20 }, { wch: 16 }, { wch: 15 }, { wch: 10 }];

      // desligados e contratos anteriores também: é deles boa parte do histórico
      const wsC = XLSX.utils.aoa_to_sheet([
        ["ID", "Unidade", "Colaborador", "Situação"],
        ...dados.pessoas.map((p) => [p.code, p.units, p.name, p.situacao]),
      ]);
      wsC["!cols"] = [{ wch: 12 }, { wch: 18 }, { wch: 38 }, { wch: 18 }];

      const wsI = XLSX.utils.aoa_to_sheet([
        ["Coluna", "Obrigatório", "Como preencher"],
        ["ID", "Sim", "A matrícula do colaborador, como no cadastro (copie da aba Colaboradores). É ela que identifica a pessoa, junto com a Unidade. O nome NÃO identifica."],
        ["Unidade", dados.multiUnidade ? "Sim" : "Não", dados.multiUnidade
          ? "A empresa tem mais de uma unidade e a mesma matrícula pode existir em unidades diferentes. Escreva o nome da unidade como cadastrado."
          : "A empresa tem uma única unidade; pode deixar em branco."],
        ["Colaborador", "Não", "Só para conferência. O sistema identifica por ID e Unidade."],
        ["Motivo", "Sim", "O nome do motivo exatamente como na aba Motivos (sem diferença de acento ou maiúscula)."],
        ["Detalhe do afastamento", "Não", "Só para afastamento e licença: Afastado pelo INSS, Acidente de trabalho ou Aposentadoria por invalidez (motivo de afastamento), ou Licença-maternidade (motivo de licença). É o que aparece como situação do colaborador; em branco ele aparece só como Afastado ou De licença."],
        ["Início", "Sim", "Primeiro dia de ausência, DD/MM/AAAA. Precisa ser antes de hoje: o que acontece de hoje em diante segue pelo Lançar ausência."],
        ["Fim", "Sim", "Último dia de ausência, DD/MM/AAAA (conta como ausência). Ausência de um dia: Início e Fim iguais."],
        ["Das / Até", "Não", "Só para ausência de horas (chegou atrasado, saiu mais cedo, consulta): o horário em que esteve ausente, HH:MM. Vale para um dia só, então Início e Fim precisam ser iguais. Ausência de horas não vira dias de ausência."],
        ["Observação", "Não", "Texto livre."],
        ["Tipo de atestado", "Não", "Médico ou Odontológico. Só é gravado nos motivos que usam dados do atestado."],
        ["CID", "Não", "Código da tabela CID-10, como M54.5 ou M54. Código que não existe na tabela recusa a linha."],
        ["Profissional / CRM / Local de atendimento", "Não", "Dados do atestado, como estão no documento."],
        ["Data de emissão", "Não", "Data em que o atestado foi emitido, DD/MM/AAAA."],
        ["Acompanhado", "Não", "Quem foi acompanhado, nos atestados de acompanhamento."],
        ["Parentesco", "Não", "Grau de parentesco do falecido. Só é gravado nos motivos que usam parentesco (Licença nojo)."],
        ["Acidente de trabalho", "Não", "Sim ou Não. Em branco vale Não."],
        ["Abonada", "Não", "Sim ou Não, só para falta. Em branco vale Não."],
        ["", "", ""],
        ["Como entra", "", "Cada linha entra JÁ APROVADA, sem comunicado por e-mail, sem aviso no sino e sem anexo. Passa a contar no relatório, na soma de 15 dias do INSS, na situação do colaborador e na remuneração variável (desconto e redutor do motivo, como na aprovação do RH)."],
        ["O vínculo da época", "", "Setor, função, gestor e unidade gravados no lançamento são os da data do absenteísmo (histórico de movimentações), não os de hoje."],
        ["Linhas recusadas", "", "Ficam de fora, com o motivo: período que cruza com férias, afastamento ou outro absenteísmo da pessoa (inclusive de outra linha da planilha), antes da admissão, depois do desligamento, de hoje em diante, CID inexistente. Antes de importar, a tela mostra quais e por quê."],
        ["Reimportar a mesma planilha", "", "Não duplica: o que já entrou volta como recusado, por cruzar com o absenteísmo importado antes."],
        ["Desfazer", "", "Um lançamento importado errado se desfaz pelo Cancelar, na ficha do lançamento, em Histórico."],
        ["Exemplos", "", "Veja a aba Exemplos. Preencha a primeira aba (Absenteísmos), que é a única lida."],
      ]);
      wsI["!cols"] = [{ wch: 34 }, { wch: 12 }, { wch: 110 }];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Absenteísmos");
      XLSX.utils.book_append_sheet(wb, wsEx, "Exemplos");
      XLSX.utils.book_append_sheet(wb, wsM, "Motivos");
      XLSX.utils.book_append_sheet(wb, wsC, "Colaboradores");
      XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
      XLSX.writeFile(wb, "modelo_historico_absenteismo.xlsx");
    } catch (e) {
      setErro("Não consegui montar o modelo: " + (e as Error).message);
    } finally {
      setOcupado("");
    }
  }

  async function lerArquivo(file: File) {
    limpar();
    const XLSX = await loadXlsx();
    const lidas: LinhaHistorico[] = [];
    let semNada = 0;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false });
      if (aoa.length < 2) { setErro("A primeira aba da planilha está vazia."); return; }
      const col = mapearColunas(aoa[0] as unknown[]);
      if (col.code < 0) { setErro("Não achei a coluna ID (matrícula) na primeira aba. Use o modelo."); return; }
      if (col.motivo < 0 || col.inicio < 0 || col.fim < 0) {
        setErro("Faltam colunas obrigatórias na primeira aba (Motivo, Início e Fim). Use o modelo.");
        return;
      }
      const cel = (r: unknown[], i: number): unknown => (i >= 0 ? r[i] : undefined);
      const txt = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
      for (let i = 1; i < aoa.length; i++) {
        const r = (aoa[i] ?? []) as unknown[];
        if (!txt(r, col.code) && !txt(r, col.name) && !txt(r, col.motivo)) { semNada++; continue; }
        lidas.push({
          linha: i + 1,
          code: txt(r, col.code),
          unit: txt(r, col.unit),
          name: txt(r, col.name),
          motivo: txt(r, col.motivo),
          detalhe: txt(r, col.detalhe),
          inicio: dataDaCelula(cel(r, col.inicio)),
          fim: dataDaCelula(cel(r, col.fim)),
          das: horaDaCelula(cel(r, col.das)),
          ate: horaDaCelula(cel(r, col.ate)),
          obs: txt(r, col.obs),
          tipoAtestado: txt(r, col.tipoAtestado),
          cid: txt(r, col.cid),
          medico: txt(r, col.medico),
          crm: txt(r, col.crm),
          local: txt(r, col.local),
          emissao: dataDaCelula(cel(r, col.emissao)),
          acompanhado: txt(r, col.acompanhado),
          parentesco: txt(r, col.parentesco),
          acidente: txt(r, col.acidente),
          abonada: txt(r, col.abonada),
        });
      }
    } catch (e) {
      setErro("Não consegui ler o arquivo: " + (e as Error).message);
      return;
    }
    if (lidas.length === 0) { setErro("Nenhuma linha preenchida na primeira aba."); return; }
    if (lidas.length > 5000) { setErro("No máximo 5.000 linhas por importação. Divida a planilha."); return; }

    setLinhas(lidas);
    setIgnoradas(semNada);
    setArquivo(file.name);
    setOcupado("previa");
    try {
      const r = await importarHistoricoAbsenteismo(lidas, true);
      if (r.error) setErro(r.error);
      else setPrevia(r);
    } finally {
      setOcupado("");
    }
  }

  async function importar() {
    if (!previa || previa.importadas === 0) return;
    const ok = await confirmDialog({
      title: "Importar histórico",
      confirmLabel: `Importar ${previa.importadas}`,
      message: `Importar ${previa.importadas} absenteísmo(s) já aprovado(s)? Eles passam a contar no relatório, no INSS e na remuneração variável, sem comunicado e sem aviso. Para desfazer, cada um precisa ser cancelado na ficha.`,
    });
    if (!ok) return;
    setOcupado("importando");
    setErro("");
    try {
      const r = await importarHistoricoAbsenteismo(linhas, false);
      if (r.error) { setErro(r.error); return; }
      setResultado(r);
      if (r.importadas > 0) {
        toast.success(`${r.importadas} absenteísmo(s) importado(s).`);
      }
    } finally {
      setOcupado("");
    }
  }

  async function baixarRecusadas(itens: RecusaHistorico[]) {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Linha", "ID", "Unidade", "Colaborador", "Período", "Por que ficou de fora"],
      ...itens.map((i) => [i.linha, i.code, i.unit, i.name, i.periodo, i.motivo]),
    ]);
    ws["!cols"] = [{ wch: 7 }, { wch: 12 }, { wch: 16 }, { wch: 34 }, { wch: 26 }, { wch: 70 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fora da importação");
    XLSX.writeFile(wb, "historico_absenteismo_fora_da_importacao.xlsx");
  }

  const mostrado = resultado ?? previa;
  const terminou = !!resultado;

  return (
    <>
      {!controlado && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAberto(true)}>
          <IconImport /> Importar histórico
        </button>
      )}
      <DetailModal
        open={aberto}
        onClose={fechar}
        title="Importar histórico de absenteísmo"
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
          Para lançar ausências anteriores ao sistema. Cada linha entra <strong>já aprovada</strong>,
          sem comunicado por e-mail, sem aviso e sem anexo, e passa a contar no relatório, no INSS e
          na remuneração variável. O que acontecer de hoje em diante segue pelo Lançar ausência.
        </p>

        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={baixarModelo} disabled={ocupado !== ""}>
            {ocupado === "modelo" ? "Montando o modelo…" : "↓ Baixar modelo"}
          </button>
        </div>

        <div>
          <label className="label" htmlFor="historico-absenteismo-arquivo">Planilha preenchida</label>
          <input
            id="historico-absenteismo-arquivo" type="file" accept=".xlsx,.xls" className="input"
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
          <div className="card card-pad" style={{ fontSize: "0.88rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <strong>{arquivo}</strong>
            <div>
              {terminou
                ? <>{mostrado.importadas} absenteísmo(s) importado(s)</>
                : <>{mostrado.importadas} pronta(s) para importar</>}
              <span className="soft">
                {" · "}{linhas.length} linha(s) lida(s)
                {ignoradas > 0 && ` · ${ignoradas} em branco ignorada(s)`}
              </span>
            </div>
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
                        Linha {i.linha} · {i.code || "sem ID"}{i.name ? ` · ${i.name}` : ""}{i.periodo ? ` · ${i.periodo}` : ""}
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
    </>
  );
}
