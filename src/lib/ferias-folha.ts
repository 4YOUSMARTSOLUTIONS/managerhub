/**
 * Leitura dos períodos aquisitivos de férias, em dois formatos reconhecidos
 * sozinhos por `lerArquivoDeFerias`:
 *
 *  1. o MODELO do MANAGERHUB (uma linha por aquisitivo, colunas com título),
 *     que serve para qualquer empresa, venha de que folha vier;
 *  2. o relatório "Programação de Férias" exportado da folha da Cervantes, que
 *     poupa o DP de copiar dados para o modelo.
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
  /** bloco do relatório da folha (no modelo, sempre 0: a unidade vem na linha) */
  bloco: number;
  /** linha da planilha (1 = primeira), para a pessoa conferir */
  linha: number;
  codigo: string;
  nome: string;
  admissao: string | null;
  /** coluna Unidade do modelo; no relatório da folha, quem diz é o bloco */
  unidade?: string;
  periodos: PeriodoFolha[];
};

export type BlocoFolha = { numero: number; pessoas: number; totalInformado: number | null };

export type LinhaInvalida = { linha: number; motivo: string };

export type RelatorioFolha = {
  formato: "folha" | "modelo";
  /**
   * Data de emissão: o que a folha sabia naquele dia. Só o relatório da folha
   * traz; no modelo, o DP informa na tela até quando os dias gozados estão
   * atualizados.
   */
  emissao: string | null;
  dataBase: string | null;
  cnpj: string | null;
  blocos: BlocoFolha[];
  pessoas: PessoaFolha[];
  /** linhas com cara de dado que não entram, e por quê */
  naoReconhecidas: LinhaInvalida[];
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
  const naoReconhecidas: LinhaInvalida[] = [];
  const ilegivel = (linha: number) =>
    naoReconhecidas.push({ linha, motivo: "linha do relatório que não foi possível ler" });
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
      if (!periodo) { ilegivel(n); return; }
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
      if (!periodo || !dono || dono.bloco !== bloco) { ilegivel(n); return; }
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
  return { relatorio: { formato: "folha", emissao, dataBase, cnpj, blocos, pessoas, naoReconhecidas } };
}

// ---------------------------------------------------------------------------
// Modelo do MANAGERHUB
// ---------------------------------------------------------------------------

/** Os títulos do modelo, na ordem em que o arquivo baixado os escreve. */
export const MODELO_COLUNAS = [
  "Unidade",
  "Matrícula",
  "Nome",
  "Início do aquisitivo",
  "Fim do aquisitivo",
  "Dias de direito",
  "Dias já gozados",
  "Gozar até",
] as const;

export const MODELO_ABA = "Períodos aquisitivos";

/** As linhas da aba de instruções do modelo (uma frase por linha). */
export const MODELO_INSTRUCOES: string[][] = [
  ["Como preencher o modelo de períodos aquisitivos de férias"],
  [""],
  ["Uma linha por período aquisitivo. Quem tem dois aquisitivos em aberto (um vencido e um em curso) ocupa duas linhas, repetindo unidade e matrícula."],
  ["A lista já vem com os colaboradores ativos. Linha sem as datas do aquisitivo é ignorada, então não é preciso apagar quem você não for preencher."],
  [""],
  ["Unidade e Matrícula: identificam o colaborador, como no cadastro. O nome é só para conferência e não é usado."],
  ["Início e Fim do aquisitivo: o período de 12 meses que dá direito às férias (datas no formato DD/MM/AAAA)."],
  ["Dias de direito: 30, ou menos quando as faltas reduzem o direito (art. 130 da CLT). Em branco vale 30."],
  ["Dias já gozados: quantos dias desse aquisitivo já foram tirados até a data que você informar na importação. Em branco vale 0."],
  ["Gozar até: o último dia em que as férias desse aquisitivo podem cair sem virar férias em dobro. Em branco vale o fim do aquisitivo mais 12 meses."],
  [""],
  ["Ao importar, o sistema pergunta até quando os dias gozados estão atualizados. Férias lançadas no sistema que começam depois dessa data são descontadas do saldo; as anteriores já devem estar somadas em Dias já gozados."],
  ["Quem vem no arquivo tem os períodos substituídos; quem não vem continua com o que foi importado antes."],
  [""],
  ["Exemplo:", "MATRIZ", "123", "FULANO DE TAL", "01/04/2025", "31/03/2026", "30", "15", "31/03/2027"],
];

/** A planilha do modelo, já com os colaboradores ativos listados. */
export function linhasDoModelo(pessoas: { unidade: string; matricula: string; nome: string }[]): unknown[][] {
  return [
    [...MODELO_COLUNAS],
    ...pessoas.map((p) => [p.unidade, p.matricula, p.nome, "", "", "", "", ""]),
  ];
}

const normCab = (v: unknown) =>
  String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** coluna de cada campo, pelo título (aceita variações óbvias de escrita) */
function colunasDoModelo(cab: unknown[]) {
  const titulos = cab.map(normCab);
  const achar = (...alternativas: ((t: string) => boolean)[]) =>
    titulos.findIndex((t) => alternativas.some((f) => f(t)));
  return {
    unidade: achar((t) => t === "unidade"),
    matricula: achar((t) => t.startsWith("matricula")),
    nome: achar((t) => t === "nome" || t.startsWith("colaborador")),
    inicio: achar((t) => t.startsWith("inicio do aquisitivo") || t.startsWith("inicio aquisitivo")),
    fim: achar((t) => t.startsWith("fim do aquisitivo") || t.startsWith("fim aquisitivo")),
    direito: achar((t) => t.startsWith("dias de direito") || t === "direito"),
    gozados: achar((t) => t.includes("gozados")),
    gozarAte: achar((t) => t.startsWith("gozar ate") || t.startsWith("prazo")),
  };
}

const somaDiasIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const umAnoDepois = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(y + 1, m - 1, d, 12));
  // 29/02 + 1 ano = 28/02 (o Date pularia para 01/03)
  if (alvo.getUTCMonth() !== m - 1) alvo.setUTCDate(0);
  return alvo.toISOString().slice(0, 10);
};

/**
 * Lê o modelo do MANAGERHUB. Cada linha preenchida vira um período; linhas da
 * mesma unidade e matrícula viram uma pessoa com vários períodos.
 *
 * "Gozar até" (o último dia de gozo) é convertido para o "limite para começar
 * o saldo", que é o que a folha informa e o que o banco guarda: assim os dois
 * formatos chegam à importação do mesmo jeito.
 */
export function lerModeloDeFerias(
  linhas: unknown[][],
  primeiraLinha = 1,
): { relatorio: RelatorioFolha; erro?: undefined } | { erro: string } {
  const iCab = linhas.findIndex((l) => {
    const c = colunasDoModelo(Array.isArray(l) ? l : []);
    return c.matricula >= 0 && c.inicio >= 0 && c.fim >= 0;
  });
  if (iCab < 0) return { erro: "Não encontrei os títulos do modelo (Matrícula, Início do aquisitivo, Fim do aquisitivo)." };
  const col = colunasDoModelo(linhas[iCab]);

  const naoReconhecidas: LinhaInvalida[] = [];
  const porPessoa = new Map<string, PessoaFolha>();

  for (let i = iCab + 1; i < linhas.length; i++) {
    const n = i + primeiraLinha;
    const l = Array.isArray(linhas[i]) ? linhas[i] : [];
    const cel = (k: number) => (k >= 0 ? l[k] : undefined);
    const recusar = (motivo: string) => naoReconhecidas.push({ linha: n, motivo });

    const iniBruto = cel(col.inicio);
    const fimBruto = cel(col.fim);
    // linha sem período: a lista vem com todo mundo, e quem não foi preenchido fica de fora sem barulho
    if (vazio(iniBruto) && vazio(fimBruto)) continue;

    const matricula = codigo(cel(col.matricula)) ?? (typeof cel(col.matricula) === "string" ? texto(cel(col.matricula)) : "");
    if (!matricula) { recusar("sem matrícula"); continue; }
    const aqInicio = data(iniBruto);
    const aqFim = data(fimBruto);
    if (!aqInicio || !aqFim) { recusar("data do aquisitivo ilegível (use DD/MM/AAAA)"); continue; }
    if (aqFim < aqInicio) { recusar("fim do aquisitivo antes do início"); continue; }

    const direitoBruto = cel(col.direito);
    const direito = vazio(direitoBruto) ? 30 : inteiro(direitoBruto);
    if (direito === null || direito < 0 || direito > 30) { recusar("dias de direito devem ser um número de 0 a 30"); continue; }
    const gozBruto = cel(col.gozados);
    const gozados = vazio(gozBruto) ? 0 : inteiro(gozBruto);
    if (gozados === null || gozados < 0 || gozados > direito) { recusar("dias já gozados devem ir de 0 até os dias de direito"); continue; }

    const ateBruto = cel(col.gozarAte);
    const gozarAte = vazio(ateBruto) ? umAnoDepois(aqFim) : data(ateBruto);
    if (!gozarAte) { recusar("data de Gozar até ilegível (use DD/MM/AAAA)"); continue; }
    if (gozarAte <= aqFim) { recusar("Gozar até precisa ser depois do fim do aquisitivo"); continue; }

    const restantes = direito - gozados;
    const unidade = col.unidade >= 0 ? texto(String(cel(col.unidade) ?? "")) : "";
    const nome = col.nome >= 0 ? texto(String(cel(col.nome) ?? "")).replace(/\s+/g, " ") : "";
    const chave = `${normCab(unidade)}|${matricula.replace(/^0+(?=\d)/, "")}`;
    const pessoa = porPessoa.get(chave) ?? {
      bloco: 0, linha: n, codigo: matricula, nome, admissao: null, unidade: unidade || undefined, periodos: [],
    };
    pessoa.periodos.push({
      aqInicio,
      aqFim,
      proporcionais: null,
      gozados,
      restantes,
      // o banco guarda o último dia para COMEÇAR o saldo; ele mais os
      // restantes, menos um, devolve o "Gozar até" informado
      limite: restantes > 0 ? somaDiasIso(gozarAte, -(restantes - 1)) : gozarAte,
      afastamento: null,
      faltas: null,
    });
    porPessoa.set(chave, pessoa);
  }

  // dois períodos da mesma pessoa não podem se cruzar nem começar no mesmo dia
  const pessoas: PessoaFolha[] = [];
  for (const p of porPessoa.values()) {
    p.periodos.sort((a, b) => a.aqInicio.localeCompare(b.aqInicio));
    const cruza = p.periodos.some((q, k) => k > 0 && q.aqInicio <= p.periodos[k - 1].aqFim);
    if (cruza) {
      naoReconhecidas.push({ linha: p.linha, motivo: `${p.nome || p.codigo}: períodos aquisitivos que se cruzam` });
      continue;
    }
    pessoas.push(p);
  }

  if (pessoas.length === 0 && naoReconhecidas.length === 0) {
    return { erro: "O modelo não tem nenhum período preenchido. Complete as datas do aquisitivo de quem vai ser importado." };
  }
  naoReconhecidas.sort((a, b) => a.linha - b.linha);
  return {
    relatorio: {
      formato: "modelo", emissao: null, dataBase: null, cnpj: null, blocos: [], pessoas, naoReconhecidas,
    },
  };
}

/**
 * Reconhece o formato pelo conteúdo: com os títulos do modelo, é o modelo;
 * senão, tenta o relatório da folha.
 */
export function lerArquivoDeFerias(
  linhas: unknown[][],
  primeiraLinha = 1,
): { relatorio: RelatorioFolha; erro?: undefined } | { erro: string } {
  const temCabecalhoDoModelo = linhas.slice(0, 30).some((l) => {
    const c = colunasDoModelo(Array.isArray(l) ? l : []);
    return c.matricula >= 0 && c.inicio >= 0 && c.fim >= 0;
  });
  if (temCabecalhoDoModelo) return lerModeloDeFerias(linhas, primeiraLinha);
  const r = lerProgramacaoDeFerias(linhas, primeiraLinha);
  if (r.erro !== undefined && /nenhum colaborador/.test(r.erro)) {
    return { erro: "Formato não reconhecido. Use o modelo do MANAGERHUB (botão Baixar modelo) ou o relatório Programação de Férias da folha." };
  }
  return r;
}
