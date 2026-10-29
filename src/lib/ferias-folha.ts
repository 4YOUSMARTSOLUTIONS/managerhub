/**
 * Leitura do relatório "Programação de Férias" exportado da folha em Excel.
 *
 * O relatório é impresso, não uma tabela: cabeçalho de página, células
 * mescladas e os valores de cada linha deslocados uma coluna em relação ao
 * título. Por isso a leitura NÃO usa índice fixo de coluna, e sim a ordem dos
 * valores preenchidos em cada linha, que é estável:
 *
 *   linha do colaborador: código, nome, admissão, vencimento, nº de férias
 *     vencidas, avos, [período]
 *   linha de continuação: [período]
 *   [período]: início e fim do aquisitivo, (início do gozo, dias, abono, 13º),
 *     dias de direito, dias gozados, dias restantes, limite para gozo,
 *     dias de afastamento, faltas
 *
 * O início e o fim do aquisitivo são os dois primeiros valores do período; os
 * seis últimos são sempre direito, gozados, restantes, limite, afastamento e
 * faltas. O miolo (gozo programado) não é usado: o que interessa ao sistema é
 * o que a folha já sabe, não o que ela tem agendado.
 *
 * "Total de empregados" fecha um bloco. Cada bloco é uma empresa (matriz,
 * filial), e o relatório não diz qual: quem diz é o DP, na tela.
 *
 * Sem IO e sem framework: o diálogo usa no navegador, e dá para testar com o
 * arquivo de verdade sem subir o app.
 */

import { parseDataPlanilha } from "@/lib/absences-import";

export type PeriodoFolha = {
  aqInicio: string;
  aqFim: string;
  /** "Dias dir.": avos adquiridos até a data base (2,5 por mês) */
  proporcionais: number | null;
  gozados: number;
  /** o que falta gozar do direito integral (30, ou menos pelas faltas) */
  restantes: number;
  /** último dia para COMEÇAR a gozar os restantes */
  limite: string | null;
  afastamento: number | null;
  faltas: number | null;
};

export type PessoaFolha = {
  bloco: number;
  /** linha da planilha (1 = primeira), para a pessoa conferir */
  linha: number;
  codigo: string;
  nome: string;
  admissao: string;
  periodos: PeriodoFolha[];
};

export type BlocoFolha = { numero: number; pessoas: number; totalInformado: number | null };

export type RelatorioFolha = {
  /** data de emissão: o que a folha sabia naquele dia */
  emissao: string;
  dataBase: string | null;
  cnpj: string | null;
  blocos: BlocoFolha[];
  pessoas: PessoaFolha[];
  /** linhas com cara de dado que não foi possível ler */
  naoReconhecidas: number[];
};

const vazio = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** data da célula, ou "" quando não é data ("..../..../......" inclusive) */
const data = (v: unknown): string => parseDataPlanilha(v);
const ehData = (v: unknown) => data(v) !== "";

/** "2,5" → 2.5; "-" e "...." → null */
function numero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const inteiro = (v: unknown): number | null => {
  const n = numero(v);
  return n !== null && Number.isInteger(n) ? n : null;
};

function codigo(v: unknown): string | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return String(v);
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return v.trim().replace(/^0+(?=\d)/, "");
  return null;
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** o valor preenchido logo depois de um rótulo ("Emissão:", "Data base:") */
function depoisDoRotulo(linha: unknown[], rotulo: RegExp): unknown {
  const i = linha.findIndex((v) => typeof v === "string" && rotulo.test(v));
  if (i < 0) return undefined;
  return linha.slice(i + 1).find((v) => !vazio(v));
}

function lerPeriodo(p: unknown[]): PeriodoFolha | null {
  if (p.length < 8 || !ehData(p[0]) || !ehData(p[1])) return null;
  const fim = p.length;
  const gozados = inteiro(p[fim - 5]);
  const restantes = inteiro(p[fim - 4]);
  const limite = data(p[fim - 3]);
  if (gozados === null || restantes === null || !limite) return null;
  return {
    aqInicio: data(p[0]),
    aqFim: data(p[1]),
    proporcionais: numero(p[fim - 6]),
    gozados,
    restantes,
    limite,
    afastamento: inteiro(p[fim - 2]),
    faltas: inteiro(p[fim - 1]),
  };
}

/**
 * `primeiraLinha`: o número, no Excel, da primeira linha recebida (leia com
 * `blankrows: true` para a contagem bater com a planilha).
 */
export function lerProgramacaoDeFerias(
  linhas: unknown[][],
  primeiraLinha = 1,
): { relatorio: RelatorioFolha; erro?: undefined } | { erro: string } {
  let emissao = "";
  let dataBase: string | null = null;
  let cnpj: string | null = null;
  const pessoas: PessoaFolha[] = [];
  const blocos: BlocoFolha[] = [];
  const naoReconhecidas: number[] = [];
  let bloco = 1;
  let noBloco = 0;

  linhas.forEach((bruta, idx) => {
    const n = idx + primeiraLinha;
    const linha = Array.isArray(bruta) ? bruta : [];
    const vals = linha.filter((v) => !vazio(v));
    if (vals.length === 0) return;

    // cabeçalho do relatório
    if (!emissao) {
      const e = depoisDoRotulo(linha, /^\s*emiss/i);
      if (e !== undefined && ehData(e)) emissao = data(e);
    }
    if (!dataBase) {
      const b = depoisDoRotulo(linha, /^\s*data\s*base/i);
      if (b !== undefined && ehData(b)) dataBase = data(b);
    }
    if (!cnpj) {
      const c = depoisDoRotulo(linha, /^\s*cnpj/i);
      if (c !== undefined) cnpj = String(c).trim();
    }

    // fim de bloco
    if (vals.some((v) => typeof v === "string" && /total de empregados/i.test(v))) {
      const total = vals.map(numero).find((x) => x !== null) ?? null;
      blocos.push({ numero: bloco, pessoas: noBloco, totalInformado: total });
      bloco += 1;
      noBloco = 0;
      return;
    }

    // linha do colaborador: código, nome, admissão...
    const cod = codigo(vals[0]);
    if (cod && texto(vals[1]) && ehData(vals[2])) {
      let ini = -1;
      for (let i = 4; i < vals.length - 1; i++) {
        if (ehData(vals[i]) && ehData(vals[i + 1])) { ini = i; break; }
      }
      const periodo = ini >= 0 ? lerPeriodo(vals.slice(ini)) : null;
      if (!periodo) { naoReconhecidas.push(n); return; }
      pessoas.push({
        bloco, linha: n, codigo: cod, nome: texto(vals[1]).replace(/\s+/g, " "),
        admissao: data(vals[2]), periodos: [periodo],
      });
      noBloco += 1;
      return;
    }

    // continuação: mais um aquisitivo do colaborador de cima
    if (ehData(vals[0]) && ehData(vals[1])) {
      const periodo = lerPeriodo(vals);
      const dono = pessoas[pessoas.length - 1];
      if (!periodo || !dono || dono.bloco !== bloco) { naoReconhecidas.push(n); return; }
      dono.periodos.push(periodo);
      return;
    }
    // o resto (títulos, rodapé, "Observações") não é dado
  });

  if (noBloco > 0) blocos.push({ numero: bloco, pessoas: noBloco, totalInformado: null });

  if (pessoas.length === 0) {
    return { erro: "Este arquivo não parece o relatório Programação de Férias da folha: nenhum colaborador foi reconhecido." };
  }
  if (!emissao) {
    return { erro: "Não encontrei a data de emissão no cabeçalho do relatório. Exporte o relatório completo, com o cabeçalho." };
  }
  return { relatorio: { emissao, dataBase, cnpj, blocos, pessoas, naoReconhecidas } };
}
