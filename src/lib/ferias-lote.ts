/**
 * Planilha de programação de férias da equipe (lançamento em lote pelo gestor).
 *
 * O modelo vem com quem só o gestor lança (níveis que não solicitam as
 * próprias férias) e o saldo de cada um, só para consulta. O gestor preenche
 * início, término, abono e 13º; quem tem dois ou três períodos ocupa duas ou
 * três linhas. As colunas de consulta são ignoradas na leitura.
 *
 * Sem IO e sem framework: o diálogo usa no navegador.
 */

import { parseDataPlanilha } from "@/lib/absences-import";

export const LOTE_ABA = "Programação";

export const LOTE_COLUNAS = [
  "Unidade",
  "Matrícula",
  "Nome",
  "Setor",
  "Aquisitivo",
  "Saldo (dias)",
  "Gozar até",
  "Início das férias",
  "Término das férias",
  "Abono (dias)",
  "Adiantar 13º",
] as const;

export const LOTE_INSTRUCOES: string[][] = [
  ["Como preencher a programação de férias da equipe"],
  [""],
  ["A lista já vem com quem só o gestor lança (os níveis que não solicitam as próprias férias). Linha sem início e término é ignorada."],
  ["Setor, Aquisitivo, Saldo e Gozar até são só para consulta: mostram o próximo saldo a programar e até quando ele precisa ser gozado. O sistema não lê essas colunas."],
  [""],
  ["Início e Término das férias: datas no formato DD/MM/AAAA. O início precisa cair de segunda a quinta, fora de feriado e dos 2 dias antes de um feriado."],
  ["Abono (dias): dias vendidos, de 0 a 10 (até um terço do direito). Em branco vale 0."],
  ["Adiantar 13º: Sim para adiantar a 1ª parcela do 13º junto destas férias. Em branco vale Não."],
  ["Férias divididas: repita a linha da pessoa (mesma unidade e matrícula), uma por período, até 3. Um dos períodos precisa ter ao menos 14 dias e nenhum menos de 5."],
  [""],
  ["Ao importar, cada pessoa passa pelas mesmas regras do botão Lançar férias. A prévia mostra quem está pronto e quem foi recusado, com o motivo; as aceitas entram aprovadas e seguem para a efetivação do DP."],
];

export type ModeloLotePessoa = {
  unidade: string | null;
  matricula: string | null;
  nome: string | null;
  setor: string | null;
  aqInicio: string | null;
  aqFim: string | null;
  saldo: number | null;
  gozarAte: string | null;
};

const br = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

export function linhasDoModeloLote(pessoas: ModeloLotePessoa[]): unknown[][] {
  return [
    [...LOTE_COLUNAS],
    ...pessoas.map((p) => [
      p.unidade ?? "", p.matricula ?? "", p.nome ?? "", p.setor ?? "",
      p.aqInicio && p.aqFim ? `${p.aqInicio.slice(0, 4)}/${p.aqFim.slice(0, 4)}` : "",
      p.saldo ?? "", br(p.gozarAte), "", "", "", "",
    ]),
  ];
}

export type PeriodoLote = { inicio: string; fim: string; abono: number; decimo: boolean };

export type PessoaLote = {
  /** linhas da planilha que formam a pessoa (uma por período) */
  linhas: number[];
  unidade?: string;
  codigo: string;
  nome: string;
  periodos: PeriodoLote[];
};

export type LinhaInvalidaLote = { linha: number; codigo: string; nome: string; motivo: string };

const vazio = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const norm = (v: unknown) =>
  texto(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

function colunas(cab: unknown[]) {
  const t = cab.map(norm);
  const achar = (f: (s: string) => boolean) => t.findIndex(f);
  return {
    unidade: achar((s) => s === "unidade"),
    matricula: achar((s) => s.startsWith("matricula")),
    nome: achar((s) => s === "nome" || s.startsWith("colaborador")),
    inicio: achar((s) => s.startsWith("inicio das ferias") || s === "inicio"),
    fim: achar((s) => s.startsWith("termino") || s.startsWith("fim das ferias") || s === "fim"),
    abono: achar((s) => s.startsWith("abono")),
    decimo: achar((s) => s.includes("13")),
  };
}

function simNao(v: unknown): boolean | null {
  const s = norm(v);
  if (!s || s === "nao" || s === "n" || s === "false" || s === "0") return false;
  if (s === "sim" || s === "s" || s === "x" || s === "true" || s === "1") return true;
  return null;
}

/**
 * Lê a planilha preenchida. Linha sem início e término é ignorada (a lista
 * vem com a equipe toda); linha com problema sai com o motivo; linhas da mesma
 * unidade e matrícula viram uma pessoa com vários períodos.
 */
export function lerPlanilhaDeLancamento(
  linhas: unknown[][],
  primeiraLinha = 1,
): { pessoas: PessoaLote[]; invalidas: LinhaInvalidaLote[]; erro?: undefined } | { erro: string } {
  const iCab = linhas.findIndex((l) => {
    const c = colunas(Array.isArray(l) ? l : []);
    return c.matricula >= 0 && c.inicio >= 0 && c.fim >= 0;
  });
  if (iCab < 0) {
    return { erro: "Não encontrei os títulos do modelo (Matrícula, Início das férias, Término das férias). Use o botão Baixar modelo." };
  }
  const col = colunas(linhas[iCab]);
  const invalidas: LinhaInvalidaLote[] = [];
  const porPessoa = new Map<string, PessoaLote>();

  for (let i = iCab + 1; i < linhas.length; i++) {
    const n = i + primeiraLinha;
    const l = Array.isArray(linhas[i]) ? linhas[i] : [];
    const cel = (k: number) => (k >= 0 ? l[k] : undefined);
    if (vazio(cel(col.inicio)) && vazio(cel(col.fim))) continue;

    const codigo = texto(cel(col.matricula)).replace(/^0+(?=\d)/, "").replace(/\.0+$/, "");
    const nome = texto(cel(col.nome)).replace(/\s+/g, " ");
    const recusar = (motivo: string) => invalidas.push({ linha: n, codigo, nome, motivo });
    if (!codigo) { recusar("sem matrícula"); continue; }

    const inicio = parseDataPlanilha(cel(col.inicio));
    const fim = parseDataPlanilha(cel(col.fim));
    if (!inicio || !fim) { recusar("data de início ou término ilegível (use DD/MM/AAAA)"); continue; }
    if (fim < inicio) { recusar("término antes do início"); continue; }

    const abonoBruto = cel(col.abono);
    const abono = vazio(abonoBruto) ? 0 : Number(texto(abonoBruto).replace(",", "."));
    if (!Number.isInteger(abono) || abono < 0 || abono > 10) { recusar("abono deve ser um número inteiro de 0 a 10"); continue; }
    const decimo = simNao(cel(col.decimo));
    if (decimo === null) { recusar("Adiantar 13º deve ser Sim ou Não"); continue; }

    const unidade = col.unidade >= 0 ? texto(cel(col.unidade)) : "";
    const chave = `${norm(unidade)}|${codigo}`;
    const p = porPessoa.get(chave) ?? { linhas: [], unidade: unidade || undefined, codigo, nome, periodos: [] };
    p.linhas.push(n);
    p.periodos.push({ inicio, fim, abono, decimo });
    porPessoa.set(chave, p);
  }

  const pessoas: PessoaLote[] = [];
  for (const p of porPessoa.values()) {
    if (p.periodos.length > 3) {
      for (const n of p.linhas) {
        invalidas.push({ linha: n, codigo: p.codigo, nome: p.nome, motivo: "mais de 3 períodos para a mesma pessoa" });
      }
      continue;
    }
    p.periodos.sort((a, b) => a.inicio.localeCompare(b.inicio));
    pessoas.push(p);
  }

  if (pessoas.length === 0 && invalidas.length === 0) {
    return { erro: "Nenhuma linha preenchida. Informe início e término das férias de quem vai ser lançado." };
  }
  invalidas.sort((a, b) => a.linha - b.linha);
  return { pessoas, invalidas };
}
