"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DetailModal } from "@/components/ui/DetailModal";
import { Field, FieldGrid } from "@/components/ui/Field";
import { IconImport } from "@/components/ui/ImpExpIcons";
import { useLeituraDePlanilha, AvisoLendoPlanilha } from "@/components/ui/LeituraDePlanilha";
import { loadXlsx } from "@/lib/xlsx-lazy";
import { importarChamados, type ResultadoImportacaoChamados } from "@/lib/actions/tickets";
import { lerExportacao, mascararLinhas, type LinhaChamado, type RecusaChamado } from "@/lib/chamados-importacao";

const LOTE = 150;
const num = (n: number) => n.toLocaleString("pt-BR");

const zerado = (): ResultadoImportacaoChamados => ({
  novos: 0, ja_existiam: 0, comentarios: 0, recusadas: [], sem_cadastro: {},
  setores_novos: [], categorias_novas: [], unidades_texto: {},
});

function somar(total: ResultadoImportacaoChamados, r: ResultadoImportacaoChamados) {
  total.novos += r.novos;
  total.ja_existiam += r.ja_existiam;
  total.comentarios += r.comentarios;
  total.recusadas.push(...r.recusadas);
  for (const [k, n] of Object.entries(r.sem_cadastro)) total.sem_cadastro[k] = (total.sem_cadastro[k] ?? 0) + n;
  for (const [k, n] of Object.entries(r.unidades_texto)) total.unidades_texto[k] = (total.unidades_texto[k] ?? 0) + n;
  total.setores_novos = [...new Set([...total.setores_novos, ...r.setores_novos])];
  total.categorias_novas = [...new Set([...total.categorias_novas, ...r.categorias_novas])];
}

/** Manda o arquivo em lotes. Para no primeiro erro geral e devolve o que já somou. */
async function rodar(
  linhas: LinhaChamado[], simular: boolean, avancar: (feitos: number) => void,
): Promise<ResultadoImportacaoChamados> {
  const total = zerado();
  for (let i = 0; i < linhas.length; i += LOTE) {
    let r: ResultadoImportacaoChamados;
    try {
      r = await importarChamados(linhas.slice(i, i + LOTE), simular);
    } catch (e) {
      total.error = `Falha de conexão: ${(e as Error).message}`;
      return total;
    }
    if (r.error) { total.error = r.error; return total; }
    somar(total, r);
    avancar(Math.min(i + LOTE, linhas.length));
  }
  return total;
}

const lista = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]);

/**
 * Importa a exportação de chamados do sistema anterior. Só o Proprietário vê.
 * Primeiro confere o arquivo inteiro sem gravar e mostra o que vai acontecer; a
 * gravação só começa depois de a pessoa ver esse resumo.
 */
export function ImportarChamadosDialog() {
  const router = useRouter();
  const { lendo, ler } = useLeituraDePlanilha();
  const [aberto, setAberto] = useState(false);
  const [arquivo, setArquivo] = useState("");
  const [linhas, setLinhas] = useState<LinhaChamado[]>([]);
  const [recusasArquivo, setRecusasArquivo] = useState<RecusaChamado[]>([]);
  const [erro, setErro] = useState("");
  const [previa, setPrevia] = useState<ResultadoImportacaoChamados | null>(null);
  const [comSenha, setComSenha] = useState(0);
  const [cobrirSenhas, setCobrirSenhas] = useState(true);
  const [progresso, setProgresso] = useState<{ rotulo: string; feitos: number; total: number } | null>(null);
  const [fim, setFim] = useState<ResultadoImportacaoChamados | null>(null);
  const ocupado = lendo || !!progresso;

  function limpar() {
    setArquivo(""); setLinhas([]); setRecusasArquivo([]); setErro("");
    setPrevia(null); setComSenha(0); setCobrirSenhas(true); setProgresso(null); setFim(null);
  }
  function fechar() {
    if (ocupado) return; // no meio do envio, fechar deixaria a importação pela metade
    setAberto(false);
    limpar();
  }

  async function aoEscolher(file: File) {
    limpar();
    try {
      const XLSX = await loadXlsx();
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const matriz = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: true });
      const lido = lerExportacao(matriz);
      if (lido.erro) { setErro(lido.erro); return; }
      if (lido.linhas.length === 0) { setErro("Nenhum chamado encontrado no arquivo."); return; }

      // a conferência já vai com as senhas cobertas: ela não precisa do valor
      const coberto = mascararLinhas(lido.linhas);
      setArquivo(file.name);
      setLinhas(lido.linhas);
      setRecusasArquivo(lido.recusas);
      setComSenha(coberto.chamados);

      setProgresso({ rotulo: "Conferindo", feitos: 0, total: lido.linhas.length });
      const r = await rodar(coberto.linhas, true, (feitos) =>
        setProgresso({ rotulo: "Conferindo", feitos, total: lido.linhas.length }));
      setProgresso(null);
      if (r.error) { setErro(r.error); return; }
      setPrevia(r);
    } catch (e) {
      setProgresso(null);
      setErro(`Não consegui ler o arquivo: ${(e as Error).message}`);
    }
  }

  async function importar() {
    const envio = cobrirSenhas ? mascararLinhas(linhas).linhas : linhas;
    setErro("");
    setProgresso({ rotulo: "Importando", feitos: 0, total: envio.length });
    const r = await rodar(envio, false, (feitos) =>
      setProgresso({ rotulo: "Importando", feitos, total: envio.length }));
    setProgresso(null);
    setFim(r);
    if (r.error) setErro(`${r.error} ${num(r.novos)} chamados já tinham entrado. Importar o mesmo arquivo de novo continua de onde parou.`);
    else toast.success(`${num(r.novos)} chamados importados.`);
    router.refresh();
  }

  const recusas = [...recusasArquivo, ...(fim ?? previa)?.recusadas ?? []].sort((a, b) => a.linha - b.linha);
  const semCadastro = lista(previa?.sem_cadastro ?? {});
  const unidades = lista(previa?.unidades_texto ?? {});

  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => setAberto(true)}>
        <IconImport /> Importar chamados
      </button>

      <DetailModal
        open={aberto}
        onClose={fechar}
        title="Importar chamados"
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
            <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={fechar}>
              {fim ? "Fechar" : "Cancelar"}
            </button>
            {previa && !fim && previa.novos > 0 && (
              <button type="button" className="btn btn-primary" disabled={ocupado} onClick={() => void importar()}>
                Importar {num(previa.novos)} chamados
              </button>
            )}
          </div>
        }
      >
        {!fim && (
          <div>
            <p className="soft" style={{ fontSize: "0.82rem", margin: "0 0 0.7rem" }}>
              Use o arquivo exportado do sistema anterior, sem alterar as colunas. Nada é gravado antes de
              você ver o resumo, ninguém recebe aviso, e importar o mesmo arquivo de novo não duplica.
            </p>
            <label className="label">Arquivo</label>
            <input
              type="file" accept=".xlsx,.xls" className="input" disabled={ocupado}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void ler(() => aoEscolher(f)); }}
            />
            <AvisoLendoPlanilha lendo={lendo} />
          </div>
        )}

        {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}

        {progresso && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: 6 }}>
              <strong>{progresso.rotulo}…</strong>
              <span className="muted">{num(progresso.feitos)} de {num(progresso.total)}</span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(progresso.feitos / progresso.total) * 100}%`, background: "var(--mh-primary-500)", transition: "width 0.2s" }} />
            </div>
            <p className="muted" style={{ fontSize: "0.78rem", margin: "6px 0 0" }}>Não feche esta janela até concluir.</p>
          </div>
        )}

        {fim && !fim.error && (
          <FieldGrid>
            <Field label="Importados">{num(fim.novos)}</Field>
            <Field label="Mensagens">{num(fim.comentarios)}</Field>
            <Field label="Já existiam">{num(fim.ja_existiam)}</Field>
            <Field label="Recusados">{num(recusas.length)}</Field>
          </FieldGrid>
        )}

        {previa && !fim && !progresso && (
          <>
            <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{arquivo}</div>
            <FieldGrid>
              <Field label="A importar">{num(previa.novos)}</Field>
              <Field label="Mensagens">{num(previa.comentarios)}</Field>
              <Field label="Já importados">{num(previa.ja_existiam)}</Field>
              <Field label="Recusados">{num(recusas.length)}</Field>
            </FieldGrid>

            {comSenha > 0 && (
              <div style={{ background: "var(--mh-warning-soft)", borderRadius: 8, padding: "0.6rem 0.7rem", fontSize: "0.8rem" }}>
                <label style={{ display: "flex", gap: "0.45rem", alignItems: "flex-start", cursor: "pointer" }}>
                  <input type="checkbox" checked={cobrirSenhas} onChange={(e) => setCobrirSenhas(e.target.checked)} style={{ marginTop: 2 }} />
                  <span>
                    <strong>Cobrir as senhas escritas nas mensagens.</strong> {num(comSenha)} chamados parecem ter senha
                    na conversa. Marcado, o valor entra como ••••••. A detecção é automática e pode deixar passar
                    alguma; quem usou uma dessas senhas deve trocá-la.
                  </span>
                </label>
              </div>
            )}

            {(previa.setores_novos.length > 0 || previa.categorias_novas.length > 0) && (
              <details style={{ fontSize: "0.82rem" }}>
                <summary style={{ cursor: "pointer" }}>
                  {num(previa.setores_novos.length)} setores e {num(previa.categorias_novas.length)} categorias novas, criados inativos
                </summary>
                <p className="soft" style={{ margin: "0.4rem 0" }}>
                  Servem ao histórico e não aparecem em &quot;Abrir chamado&quot; até serem ativados em Configurações.
                </p>
                <ul className="muted" style={{ margin: 0, paddingLeft: "1.1rem", maxHeight: 150, overflowY: "auto" }}>
                  {previa.setores_novos.map((s) => <li key={s}>Setor: {s}</li>)}
                  {previa.categorias_novas.map((c) => <li key={c}>{c}</li>)}
                </ul>
              </details>
            )}

            {semCadastro.length > 0 && (
              <details style={{ fontSize: "0.82rem" }}>
                <summary style={{ cursor: "pointer" }}>{num(semCadastro.length)} pessoas sem cadastro, entram só com o nome</summary>
                <ul className="muted" style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem", maxHeight: 150, overflowY: "auto" }}>
                  {semCadastro.map(([nome, n]) => <li key={nome}>{nome} ({num(n)})</li>)}
                </ul>
              </details>
            )}

            {unidades.length > 0 && (
              <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
                Unidade sem cadastro, fica como texto e o chamado aparece em todas as unidades:{" "}
                {unidades.map(([u, n]) => `${u} (${num(n)})`).join(", ")}.
              </p>
            )}
          </>
        )}

        {recusas.length > 0 && !progresso && (
          <details style={{ fontSize: "0.82rem" }}>
            <summary style={{ cursor: "pointer", color: "var(--mh-danger)" }}>{num(recusas.length)} linhas recusadas</summary>
            <ul className="muted" style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem", maxHeight: 150, overflowY: "auto" }}>
              {recusas.map((r) => <li key={`${r.linha}-${r.motivo}`}>Linha {r.linha}: {r.motivo}</li>)}
            </ul>
          </details>
        )}
      </DetailModal>
    </>
  );
}
