// Espelho CLIENT-SIDE das regras CLT de férias.
//
// A fonte da verdade é o banco (`ferias_validar_periodos`, security definer):
// tudo aqui existe só para o formulário recusar antes do round-trip, com a
// MESMA mensagem que o banco daria. Se as duas divergirem, vale a do banco.
//
// Sem IO e sem dependência de framework: usado pelo dialog no cliente.

import { holidayName } from "@/lib/holidays";

export type FeriadoCustom = { day: string; name: string };

export type PeriodoInput = {
  inicio: string; // YYYY-MM-DD
  fim: string;
  abono: number;
  decimo: boolean;
};

export type AquisitivoInfo = {
  aqInicio: string;
  aqFim: string;
  concessivoFim: string;
  diasDireito: number;
  diasUsados: number;
  abonoUsado: number;
  saldo: number;
  qtdPeriodos: number;
  situacao: string;
};

/** Data local ancorada ao meio-dia: aritmética de dias sem surpresa de fuso. */
export const dataLocal = (iso: string) => new Date(`${iso}T12:00:00`);

export function diasDoPeriodo(inicio: string, fim: string): number {
  return Math.round((+dataLocal(fim) - +dataLocal(inicio)) / 86_400_000) + 1;
}

const somaDias = (iso: string, n: number) => {
  const d = dataLocal(iso);
  d.setDate(d.getDate() + n);
  return d;
};

/**
 * Por que a data de INÍCIO não serve, ou null se serve (art. 134 §3º: nada de
 * começar no descanso semanal, nos 2 dias que o antecedem, em feriado ou nos 2
 * dias antes de um feriado).
 */
export function motivoInicioInvalido(inicio: string, feriados: FeriadoCustom[]): string | null {
  const d = dataLocal(inicio);
  const dow = d.getDay();
  if (dow === 0 || dow === 5 || dow === 6) {
    const dia = dow === 0 ? "num domingo" : dow === 5 ? "numa sexta-feira" : "num sábado";
    return `As férias não podem começar ${dia}: escolha de segunda a quinta (art. 134).`;
  }
  if (holidayName(d, feriados)) return "O início cai num feriado (art. 134).";
  if (holidayName(somaDias(inicio, 1), feriados) || holidayName(somaDias(inicio, 2), feriados)) {
    return "O início cai nos 2 dias que antecedem um feriado (art. 134).";
  }
  return null;
}

export type ResultadoValidacao =
  | { erro: string }
  | { erro?: undefined; atribuicoes: { aqInicio: string; aqFim: string }[] };

/**
 * O mesmo FIFO do banco: o aquisitivo aberto mais antigo com saldo paga
 * primeiro, sem transbordo. Devolve a que aquisitivo cada período vai, ou a
 * primeira infração encontrada.
 */
export function validarConjunto(
  periodos: PeriodoInput[],
  aquisitivos: AquisitivoInfo[],
  hoje: string,
  feriados: FeriadoCustom[],
): ResultadoValidacao {
  if (periodos.length === 0) return { erro: "Informe ao menos um período de férias." };
  if (periodos.length > 3) return { erro: "As férias podem ser divididas em no máximo 3 períodos (art. 134)." };

  const ordenados = [...periodos].sort((a, b) => a.inicio.localeCompare(b.inicio));
  for (const p of ordenados) {
    if (!p.inicio || !p.fim) return { erro: "Informe o início e o término de cada período." };
    if (p.fim < p.inicio) return { erro: "O término não pode ser antes do início." };
    if (diasDoPeriodo(p.inicio, p.fim) < 5) {
      return { erro: "Nenhum período pode ter menos de 5 dias corridos (art. 134)." };
    }
    if (p.abono < 0 || p.abono > 10) return { erro: "O abono pecuniário vai de 0 a 10 dias (art. 143)." };
    if (diasDoPeriodo(p.inicio, p.fim) + p.abono > 30) {
      return { erro: "Período mais abono não podem passar de 30 dias." };
    }
    if (p.inicio <= hoje) return { erro: "A previsão precisa começar depois de hoje." };
    const motivo = motivoInicioInvalido(p.inicio, feriados);
    if (motivo) return { erro: motivo };
  }
  for (let i = 1; i < ordenados.length; i++) {
    if (ordenados[i].inicio <= ordenados[i - 1].fim) {
      return { erro: "Os períodos solicitados se cruzam entre si." };
    }
  }

  if (aquisitivos.length === 0) {
    return { erro: "A data de admissão não está cadastrada. Peça ao departamento pessoal." };
  }

  // cópia mutável para simular os débitos na ordem
  const aq = aquisitivos.map((a) => ({ ...a, tem14: false, rotulo: rotuloAquisitivo(a) }));
  const atribuicoes: { aqInicio: string; aqFim: string }[] = [];

  for (const p of ordenados) {
    const alvo = aq.find((a) => a.saldo > 0);
    if (!alvo) {
      return { erro: "Não há saldo de férias disponível: todos os períodos aquisitivos estão quitados ou reservados." };
    }
    const dias = diasDoPeriodo(p.inicio, p.fim);
    if (alvo.aqFim >= p.inicio) {
      return { erro: `O período aquisitivo ${alvo.rotulo} só se completa em ${dataBr(alvo.aqFim)}. Férias deste saldo podem começar depois disso.` };
    }
    if (dias + p.abono > alvo.saldo) {
      return { erro: `O período de ${dias} dias${p.abono > 0 ? ` (mais ${p.abono} de abono)` : ""} excede o saldo de ${alvo.saldo} dias do aquisitivo ${alvo.rotulo}.` };
    }
    if (alvo.qtdPeriodos + 1 > 3) {
      return { erro: `O aquisitivo ${alvo.rotulo} já tem 3 períodos previstos (art. 134).` };
    }
    if (alvo.abonoUsado + p.abono > 10) {
      return { erro: `O abono pecuniário do aquisitivo ${alvo.rotulo} passaria de 10 dias (art. 143).` };
    }
    alvo.saldo -= dias + p.abono;
    alvo.qtdPeriodos += 1;
    alvo.abonoUsado += p.abono;
    if (dias >= 14) alvo.tem14 = true;
    atribuicoes.push({ aqInicio: alvo.aqInicio, aqFim: alvo.aqFim });
  }

  // invariante do art. 134 §1º: ou já entrou um período >= 14, ou o saldo
  // restante ainda comporta um. Períodos já vivos no banco contam via
  // qtdPeriodos/saldo; o >= 14 existente é aproximado por "saldo <= 16"
  // (30 - 14 = 16): se o aquisitivo tinha uso e sobrou pouco, o banco decide.
  for (const a of aq) {
    const usadoAgora = atribuicoes.some((x) => x.aqInicio === a.aqInicio);
    const tinhaUso = (aquisitivos.find((x) => x.aqInicio === a.aqInicio)?.diasUsados ?? 0) > 0;
    if (usadoAgora && !a.tem14 && !tinhaUso && a.saldo < 14) {
      return { erro: `Um dos períodos do aquisitivo ${a.rotulo} precisa ter ao menos 14 dias corridos (art. 134): restariam só ${a.saldo} dias para isso.` };
    }
  }

  return { atribuicoes };
}

export function rotuloAquisitivo(a: { aqInicio: string; aqFim: string }): string {
  return `${a.aqInicio.slice(0, 4)}/${a.aqFim.slice(0, 4)}`;
}

const dataBr = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
