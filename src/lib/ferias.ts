// Espelho CLIENT-SIDE das regras CLT de férias.
//
// A fonte da verdade é o banco (`ferias_validar_periodos`, security definer):
// tudo aqui existe só para o formulário recusar antes do round-trip, com a
// MESMA mensagem que o banco daria. Se as duas divergirem, vale a do banco.
//
// Sem IO e sem dependência de framework: usado pelo dialog no cliente.

import { holidayName } from "@/lib/holidays";
import { somarDias } from "@/lib/format";

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
  /** último dia em que o gozo pode cair sem virar dobra */
  concessivoFim: string;
  diasDireito: number;
  diasUsados: number;
  abonoUsado: number;
  saldo: number;
  qtdPeriodos: number;
  situacao: string;
  /** "folha" (relatório importado) ou "admissao" (calculado, empresa que não importa) */
  origem: string;
  /** emissão do relatório da folha de onde o aquisitivo veio */
  referencia: string | null;
  /** dias que a folha já registrou como gozados */
  gozadosFolha: number;
  /** "Limite p/ gozo" da folha: último dia para começar o saldo */
  limiteGozo: string | null;
  /** já existe um período com o mínimo do art. 134 (14 dias, ou o direito todo) */
  tem14: boolean;
};

/** A linha de `ferias_periodos_aquisitivos` no formato da tela. */
export function aquisitivoDaLinha(a: {
  aq_inicio: string; aq_fim: string; concessivo_fim: string;
  dias_direito: number; dias_usados: number; abono_usado: number; saldo: number;
  qtd_periodos: number; situacao: string;
  origem: string; referencia: string | null; gozados_folha: number;
  limite_gozo: string | null; tem14: boolean;
}): AquisitivoInfo {
  return {
    aqInicio: a.aq_inicio,
    aqFim: a.aq_fim,
    concessivoFim: a.concessivo_fim,
    diasDireito: a.dias_direito,
    diasUsados: a.dias_usados,
    abonoUsado: a.abono_usado,
    saldo: a.saldo,
    qtdPeriodos: a.qtd_periodos,
    situacao: a.situacao,
    origem: a.origem,
    referencia: a.referencia,
    gozadosFolha: a.gozados_folha ?? 0,
    limiteGozo: a.limite_gozo,
    tem14: !!a.tem14,
  };
}

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
  | { erro?: undefined; atribuicoes: { aqInicio: string; aqFim: string; emDobro: boolean }[] };

/** Um período que já pediu o adiantamento do 13º (o próprio pedido em edição fica de fora). */
export type DecimoPedido = { inicio: string; fim: string };

export type OpcoesValidacao = {
  /** o DP lançando férias em dobro (gozo depois do prazo de concessão) */
  permiteDobro?: boolean;
  /** a empresa importa os aquisitivos da folha */
  usaFolha?: boolean;
  /** antecedência mínima de quem lança, em dias (0 = sem) */
  antecedencia?: number;
  /** quem lança: muda só a mensagem (cada um tem o seu valor em Configurações) */
  antecedenciaQuem?: QuemLanca;
  /** os 13º já pedidos por esta pessoa, para a regra de uma vez por ano */
  decimos?: DecimoPedido[];
  /** prazos legais do pedido de abono e de 13º (o bloqueio só vale para o colaborador) */
  prazos?: ContextoPrazos;
};

/** O primeiro dia em que um pedido com essa antecedência pode começar. */
export function inicioMinimo(hoje: string, antecedencia: number): string | null {
  return antecedencia > 0 ? somarDias(hoje, antecedencia) : null;
}

/** Quem está lançando: cada um tem a sua antecedência mínima (Configurações > Férias). */
export type QuemLanca = "colaborador" | "gestor" | "dp";

/** A mesma mensagem de `ferias_checar_antecedencia`. */
export function mensagemAntecedencia(hoje: string, antecedencia: number, quem: QuemLanca = "colaborador"): string {
  const data = dataBr(somarDias(hoje, antecedencia));
  if (quem === "gestor") {
    return `Férias lançadas pelo gestor precisam começar com pelo menos ${antecedencia} dias de antecedência, para o departamento pessoal calcular e pagar a tempo. O início mais próximo possível é ${data}.`;
  }
  if (quem === "dp") {
    return `Férias lançadas pelo departamento pessoal precisam começar com pelo menos ${antecedencia} dias de antecedência. O início mais próximo possível é ${data}.`;
  }
  return `As férias precisam ser solicitadas com pelo menos ${antecedencia} dias de antecedência, para o departamento pessoal calcular e pagar a tempo. O início mais próximo possível é ${data}.`;
}

const anoDe = (iso: string) => iso.slice(0, 4);

/**
 * Lei 4.749/65: a 1ª parcela do 13º se adianta uma vez por ano (o do início do
 * período). Devolve a primeira infração, ou null.
 */
function erroDecimo(periodos: PeriodoInput[], decimos: DecimoPedido[]): string | null {
  const ordenados = [...periodos].filter((p) => p.inicio).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const vistos = new Set<string>();
  for (const p of ordenados) {
    if (!p.decimo) continue;
    const ano = anoDe(p.inicio);
    if (vistos.has(ano)) {
      return `O adiantamento da 1ª parcela do 13º só pode ser pedido uma vez por ano: deixe marcado apenas o primeiro período de ${ano} deste pedido.`;
    }
    vistos.add(ano);
    const ja = decimos.find((d) => anoDe(d.inicio) === ano);
    if (ja) {
      return `O adiantamento da 1ª parcela do 13º de ${ano} já foi pedido nas férias de ${dataBr(ja.inicio)} a ${dataBr(ja.fim)}. Ele é pago uma vez por ano, então este período fica sem a opção.`;
    }
  }
  return null;
}

/** `aviso` = permitido, mas fora do prazo legal (a empresa pode recusar). */
export type PermissaoCampo = { ok: true; aviso?: string } | { ok: false; motivo: string };

// ---------- Prazos legais do pedido (abono e 13º) ----------

/** O que a empresa faz com o pedido do colaborador fora do prazo (Configurações > Férias). */
export type ModoPrazo = "alerta" | "bloquear";
export type PrazosLegais = { abono: ModoPrazo; decimo: ModoPrazo };

export type ContextoPrazos = {
  modos: PrazosLegais;
  /** só o colaborador é bloqueado; o lançamento do gestor/DP é o aceite da empresa */
  quem: QuemLanca;
  hoje: string;
  /** na correção e no reagendamento, o que já vinha pedido conta pela data original */
  pedidoAbono?: string | null;
  pedidoDecimo?: string | null;
};

/** art. 143 §1º: até 15 dias antes do fim do aquisitivo (fim 01/02 → até 18/01). */
export const prazoDoAbono = (aqFim: string) => somarDias(aqFim, -14);
/** Lei 4.749/65: até janeiro do ano das férias. */
export const prazoDoDecimo = (inicio: string) => `${inicio.slice(0, 4)}-01-31`;

/** As mesmas mensagens de `ferias_aplicar_prazos_legais`. */
function avaliarAbonoNoPrazo(aqInicio: string, aqFim: string, ctx: ContextoPrazos): PermissaoCampo {
  const prazo = prazoDoAbono(aqFim);
  if ((ctx.pedidoAbono ?? ctx.hoje) <= prazo) return { ok: true };
  if (ctx.quem === "colaborador" && ctx.modos.abono === "bloquear") {
    return { ok: false, motivo: `O abono pecuniário do aquisitivo ${anoDe(aqInicio)}/${anoDe(aqFim)} precisava ser pedido até ${dataBr(prazo)}, 15 dias antes do fim do período aquisitivo (art. 143 §1º). Fora desse prazo, só o gestor ou o departamento pessoal podem lançar.` };
  }
  return {
    ok: true,
    aviso: ctx.quem === "colaborador"
      ? `Pedido fora do prazo (até ${dataBr(prazo)}, art. 143 §1º): a empresa pode recusar o abono.`
      : `Fora do prazo legal (até ${dataBr(prazo)}, art. 143 §1º): lançando, a empresa aceita o abono.`,
  };
}

function avaliarDecimoNoPrazo(inicio: string, ctx: ContextoPrazos): PermissaoCampo {
  const ano = anoDe(inicio);
  if ((ctx.pedidoDecimo ?? ctx.hoje) <= prazoDoDecimo(inicio)) return { ok: true };
  if (ctx.quem === "colaborador" && ctx.modos.decimo === "bloquear") {
    return { ok: false, motivo: `O adiantamento da 1ª parcela do 13º com férias em ${ano} precisava ser pedido até 31/01/${ano} (Lei 4.749/65). Fora desse prazo, só o gestor ou o departamento pessoal podem lançar.` };
  }
  return {
    ok: true,
    aviso: ctx.quem === "colaborador"
      ? `Pedido fora do prazo (até 31/01/${ano}): a empresa pode recusar o adiantamento do 13º.`
      : `Fora do prazo legal (até 31/01/${ano}): lançando, a empresa aceita o adiantamento do 13º.`,
  };
}

/**
 * O que cada período do formulário pode pedir, na ordem em que aparecem na
 * tela (não na ordem de data):
 *  - abono: só no primeiro período de gozo do aquisitivo (art. 143) e, com
 *    `prazos`, pedido até 15 dias antes do fim dele. Usa o mesmo FIFO do banco;
 *    `null` quando ainda faltam datas para saber.
 *  - 13º: uma vez por ano (o do início do período) e, com `prazos`, pedido até
 *    janeiro desse ano.
 */
export function permissoesPorPeriodo(
  periodos: PeriodoInput[],
  aquisitivos: AquisitivoInfo[] | null,
  decimos: DecimoPedido[],
  prazos?: ContextoPrazos,
): { abono: PermissaoCampo | null; decimo: PermissaoCampo }[] {
  const completos = periodos
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.inicio && p.fim && p.fim >= p.inicio)
    .sort((a, b) => a.p.inicio.localeCompare(b.p.inicio));

  // abono: simula o FIFO só quando há saldo à vista e todas as datas preenchidas
  const abono: (PermissaoCampo | null)[] = periodos.map(() => null);
  if (aquisitivos && aquisitivos.length > 0 && completos.length === periodos.length) {
    const aq = aquisitivos.map((a) => ({ ...a, usadoAgora: false }));
    for (const { p, i } of completos) {
      const alvo = aq.find((a) => a.saldo > 0);
      if (!alvo) break;
      if (alvo.qtdPeriodos === 0) {
        abono[i] = prazos ? avaliarAbonoNoPrazo(alvo.aqInicio, alvo.aqFim, prazos) : { ok: true };
      } else {
        abono[i] = {
          ok: false,
          motivo: alvo.usadoAgora
            ? "O abono vai no período mais cedo deste pedido."
            : alvo.gozadosFolha > 0 && alvo.qtdPeriodos === 1
              ? `O abono só vale no primeiro período do aquisitivo ${rotuloAquisitivo(alvo)}, e a folha já registra ${alvo.gozadosFolha} dia(s) gozados dele.`
              : `O abono só vale no primeiro período do aquisitivo ${rotuloAquisitivo(alvo)}, que já tem férias programadas.`,
        };
      }
      alvo.saldo -= diasDoPeriodo(p.inicio, p.fim) + p.abono;
      alvo.qtdPeriodos += 1;
      alvo.usadoAgora = true;
    }
  }

  // 13º: o primeiro período de cada ano (por data) fica com a opção
  const decimo: PermissaoCampo[] = periodos.map((p, i) => {
    if (!p.inicio) return { ok: true };
    const ano = anoDe(p.inicio);
    const ja = decimos.find((d) => anoDe(d.inicio) === ano);
    if (ja) return { ok: false, motivo: `O 13º de ${ano} já foi adiantado nas férias de ${dataBr(ja.inicio)} a ${dataBr(ja.fim)}.` };
    const outro = periodos.findIndex((q, j) =>
      j !== i && q.decimo && q.inicio && anoDe(q.inicio) === ano
        && (!p.decimo || q.inicio < p.inicio));
    if (outro >= 0) return { ok: false, motivo: `O 13º de ${ano} já está marcado no período ${outro + 1} (uma vez por ano).` };
    return prazos ? avaliarDecimoNoPrazo(p.inicio, prazos) : { ok: true };
  });

  return periodos.map((_, i) => ({ abono: abono[i], decimo: decimo[i] }));
}

/**
 * O mesmo FIFO do banco: o aquisitivo aberto mais antigo com saldo paga
 * primeiro, sem transbordo. Devolve a que aquisitivo cada período vai, ou a
 * primeira infração encontrada.
 *
 * `permiteDobro`: o DP lançando férias em dobro (gozo depois do prazo de
 * concessão). `usaFolha`: a empresa importa os aquisitivos da folha, e a falta
 * deles quer dizer "não veio no relatório", não "sem admissão".
 */
export function validarConjunto(
  periodos: PeriodoInput[],
  aquisitivos: AquisitivoInfo[],
  hoje: string,
  feriados: FeriadoCustom[],
  opcoes: OpcoesValidacao = {},
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

  // antecedência mínima de quem lança (o banco usa o "hoje" do servidor)
  const minimo = inicioMinimo(hoje, opcoes.antecedencia ?? 0);
  if (minimo && ordenados[0].inicio < minimo) {
    return { erro: mensagemAntecedencia(hoje, opcoes.antecedencia ?? 0, opcoes.antecedenciaQuem) };
  }

  const decimo = erroDecimo(ordenados, opcoes.decimos ?? []);
  if (decimo) return { erro: decimo };

  if (aquisitivos.length === 0) {
    return {
      erro: opcoes.usaFolha
        ? "Os períodos aquisitivos ainda não foram importados, então o saldo não pode ser conferido. Peça ao departamento pessoal."
        : "A data de admissão não está cadastrada. Peça ao departamento pessoal.",
    };
  }

  // cópia mutável para simular os débitos na ordem
  const aq = aquisitivos.map((a) => ({ ...a, rotulo: rotuloAquisitivo(a), usadoAgora: false }));
  const atribuicoes: { aqInicio: string; aqFim: string; emDobro: boolean }[] = [];

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
      return { erro: `O aquisitivo ${alvo.rotulo} já tem 3 períodos (art. 134).` };
    }
    // art. 143: o abono vai no PRIMEIRO período de gozo do aquisitivo.
    // `qtdPeriodos` já conta o gozo da folha e as previsões do módulo. (O banco
    // ainda recusa um período que passe à frente de outro que já leva o abono;
    // aqui não há as datas das previsões para conferir isso.)
    if (p.abono > 0 && alvo.qtdPeriodos > 0) {
      const motivo = alvo.usadoAgora
        ? "coloque o abono no período mais cedo deste pedido"
        : alvo.gozadosFolha > 0 && alvo.qtdPeriodos === 1
          ? `a folha já registra ${alvo.gozadosFolha} dia(s) gozados dele`
          : "o aquisitivo já tem férias programadas";
      return { erro: `O abono pecuniário só pode ser pedido no primeiro período de gozo do aquisitivo ${alvo.rotulo} (art. 143), e este não é o primeiro: ${motivo}.` };
    }
    // art. 143: até um terço do direito (30 → 10; 18 → 6)
    const tetoAbono = Math.floor(alvo.diasDireito / 3);
    if (alvo.abonoUsado + p.abono > tetoAbono) {
      return { erro: `O abono pecuniário do aquisitivo ${alvo.rotulo} passaria de ${tetoAbono} dias, um terço do direito (art. 143).` };
    }
    // art. 134 e 137: o gozo cabe no prazo de concessão; o que passa vira dobra
    const emDobro = p.fim > alvo.concessivoFim;
    if (emDobro && !opcoes.permiteDobro) {
      return { erro: `As férias do aquisitivo ${alvo.rotulo} precisam terminar até ${dataBr(alvo.concessivoFim)} (fim do prazo de concessão). Depois disso elas viram férias em dobro (art. 137), e só o departamento pessoal pode lançar, com justificativa.` };
    }
    alvo.saldo -= dias + p.abono;
    alvo.qtdPeriodos += 1;
    alvo.usadoAgora = true;
    alvo.abonoUsado += p.abono;
    if (dias >= Math.min(14, alvo.diasDireito)) alvo.tem14 = true;
    atribuicoes.push({ aqInicio: alvo.aqInicio, aqFim: alvo.aqFim, emDobro });
  }

  // invariante do art. 134 §1º: ou já existe um período com o mínimo, ou o
  // saldo restante ainda comporta um. Quem tem direito menor que 14 (art. 130)
  // não tem como fracionar: o mínimo vira o próprio direito.
  for (const a of aq) {
    const usadoAgora = atribuicoes.some((x) => x.aqInicio === a.aqInicio);
    const minimo = Math.min(14, a.diasDireito);
    if (usadoAgora && !a.tem14 && a.saldo < minimo) {
      return { erro: `Um dos períodos do aquisitivo ${a.rotulo} precisa ter ao menos ${minimo} dias corridos (art. 134): com este pedido restariam só ${a.saldo} dias para isso.` };
    }
    // art. 134 §1º: nenhum período tem menos de 5 dias, e são no máximo 3. O
    // que sobrar no aquisitivo precisa caber num período futuro.
    if (usadoAgora && a.saldo >= 1 && a.saldo <= 4) {
      return { erro: `Com este pedido sobrariam ${a.saldo} dia(s) no aquisitivo ${a.rotulo}, e nenhum período de férias pode ter menos de 5 dias (art. 134). Use o saldo todo ou deixe ao menos 5 dias para um próximo período.` };
    }
    if (usadoAgora && a.qtdPeriodos >= 3 && a.saldo > 0) {
      return { erro: `O aquisitivo ${a.rotulo} chegaria ao 3º período com ${a.saldo} dia(s) ainda sobrando, e as férias podem ser divididas em no máximo 3 períodos (art. 134). Use o saldo todo neste período.` };
    }
  }

  // prazos legais do pedido: no banco rodam depois de todas as regras acima
  // (`ferias_aplicar_prazos_legais`), e só barram o colaborador
  if (opcoes.prazos) {
    for (let k = 0; k < ordenados.length; k++) {
      const p = ordenados[k];
      const a = atribuicoes[k];
      if (p.abono > 0) {
        const r = avaliarAbonoNoPrazo(a.aqInicio, a.aqFim, opcoes.prazos);
        if (!r.ok) return { erro: r.motivo };
      }
      if (p.decimo) {
        const r = avaliarDecimoNoPrazo(p.inicio, opcoes.prazos);
        if (!r.ok) return { erro: r.motivo };
      }
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
