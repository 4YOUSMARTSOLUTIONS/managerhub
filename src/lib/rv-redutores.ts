/**
 * Redutores da remuneração variável: quanto a CONDUTA do mês corta do pote.
 *
 * Fica ao lado de `rv-proporcional.ts` e pelo mesmo motivo: é a parte com
 * decisão de verdade, e separada do componente se confere sem abrir o navegador.
 * As duas somam para formar o valor pago:
 *
 *     pote = vigente × fatorProporcional × fatorRedutor
 *
 * A diferença entre as duas é o que cada uma responde. O proporcional pergunta
 * "quantos dias do mês esta pessoa esteve na empresa"; o redutor pergunta "o que
 * aconteceu no mês que a política da empresa manda descontar".
 *
 * Nada aqui é constante de negócio: as faixas e os próprios motivos vêm de
 * `rv_reducer_rules` / `rv_reducer_bands`, que cada empresa configura. Sem regra
 * cadastrada o fator é 1 e o valor pago não muda em nada.
 */

/** Ausência já recortada ao mês, com o tipo, porque a regra é por tipo. */
export type AusenciaTipada = { kind: string; inicio: string; fim: string };
/** Punição registrada: só a data e o tipo. O motivo escrito não chega aqui. */
export type SancaoLite = { tipoId: string; data: string };

export type FaixaRedutor = { min: number; max: number | null; pct: number };
export type RegraRedutor = {
  id: string;
  nome: string;
  fonte: "absence" | "sanction";
  /** quando `fonte === "absence"`: o tipo de ausência que a regra observa */
  absenceKind: string | null;
  /** quando `fonte === "sanction"`: o tipo de punição, ou null para "qualquer" */
  sanctionTypeId: string | null;
  faixas: FaixaRedutor[];
};

export type RedutorAplicado = {
  regraId: string;
  nome: string;
  /** dias (ausência) ou ocorrências (punição) que caíram na faixa */
  quantidade: number;
  pct: number;
};
export type ResultadoRedutor = {
  aplicados: RedutorAplicado[];
  /** soma dos percentuais das regras, com teto de 100 */
  pctTotal: number;
  /** 1 - pctTotal/100, entre 0 e 1 */
  fator: number;
};

const SEM_REDUTOR: ResultadoRedutor = { aplicados: [], pctTotal: 0, fator: 1 };

/** primeiro e último dia da competência `YYYY-MM-01`, como texto comparável */
function limitesDoMes(period: string): { primeiro: string; ultimo: string; dias: number } | null {
  if (!/^\d{4}-\d{2}/.test(period)) return null;
  const ano = Number(period.slice(0, 4));
  const mes = Number(period.slice(5, 7));
  if (!(mes >= 1 && mes <= 12)) return null;
  const dias = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const aaaaMm = period.slice(0, 7);
  return { primeiro: `${aaaaMm}-01`, ultimo: `${aaaaMm}-${String(dias).padStart(2, "0")}`, dias };
}

/**
 * Quantos dias daquele tipo de ausência caem DENTRO do mês.
 *
 * Marca os dias num conjunto em vez de somar os períodos, pela mesma razão de
 * `fatorRv`: dois lançamentos que se cruzam marcam o mesmo dia duas vezes e ele
 * continua valendo um. E um afastamento que começa em junho e termina em agosto
 * contribui só com os dias de julho.
 */
function diasNoMes(period: string, ausencias: AusenciaTipada[], kind: string): number {
  const lim = limitesDoMes(period);
  if (!lim) return 0;
  const marcados = new Set<string>();
  for (const a of ausencias) {
    if (a.kind !== kind) continue;
    const de = a.inicio > lim.primeiro ? a.inicio : lim.primeiro;
    const ate = a.fim < lim.ultimo ? a.fim : lim.ultimo;
    if (de > ate) continue;
    for (let d = Number(de.slice(8, 10)); d <= Number(ate.slice(8, 10)); d++) {
      marcados.add(String(d));
    }
  }
  return marcados.size;
}

/** Quantas punições do tipo (ou de qualquer tipo) caem no mês. */
function ocorrenciasNoMes(period: string, sancoes: SancaoLite[], tipoId: string | null): number {
  const aaaaMm = period.slice(0, 7);
  return sancoes.filter((s) => s.data.slice(0, 7) === aaaaMm && (tipoId == null || s.tipoId === tipoId)).length;
}

/**
 * A faixa que a quantidade alcança. **Uma só**, nunca a soma de várias: essa é a
 * regra combinada com o cliente, e o banco a garante com uma constraint de
 * exclusão que impede cadastrar faixas sobrepostas. Aqui a busca é linear e a
 * primeira que casa é a resposta, porque não existe segunda.
 */
export function faixaPara(qtd: number, faixas: FaixaRedutor[]): FaixaRedutor | null {
  if (qtd <= 0) return null;
  return faixas.find((f) => qtd >= f.min && (f.max == null || qtd <= f.max)) ?? null;
}

/**
 * O corte do mês.
 *
 * Motivos DIFERENTES somam os percentuais, com teto de 100: um atestado de 5
 * dias (50%) mais uma advertência (100%) zera, e não fica negativo. Dentro de um
 * motivo vale só a faixa alcançada.
 */
export function redutoresDoMes(
  period: string,
  ausencias: AusenciaTipada[],
  sancoes: SancaoLite[],
  regras: RegraRedutor[],
): ResultadoRedutor {
  if (regras.length === 0) return SEM_REDUTOR;

  const aplicados: RedutorAplicado[] = [];
  for (const r of regras) {
    const qtd = r.fonte === "absence"
      ? (r.absenceKind ? diasNoMes(period, ausencias, r.absenceKind) : 0)
      : ocorrenciasNoMes(period, sancoes, r.sanctionTypeId);
    if (qtd <= 0) continue;
    const faixa = faixaPara(qtd, r.faixas);
    if (!faixa || faixa.pct <= 0) continue;
    aplicados.push({ regraId: r.id, nome: r.nome, quantidade: qtd, pct: faixa.pct });
  }

  if (aplicados.length === 0) return SEM_REDUTOR;
  const pctTotal = Math.min(100, aplicados.reduce((s, a) => s + a.pct, 0));
  return { aplicados, pctTotal, fator: 1 - pctTotal / 100 };
}

/**
 * Os tipos de ausência que já são cobrados por faixa.
 *
 * `fatorRv` usa isto para NÃO descontar esses dias de novo no proporcional.
 * Sem isso, um atestado de 5 dias cortaria 50% pela faixa e mais 5/31 pelo tempo
 * fora, e ninguém saberia explicar o valor que saiu.
 */
export function kindsComRedutor(regras: RegraRedutor[]): Set<string> {
  const s = new Set<string>();
  for (const r of regras) if (r.fonte === "absence" && r.absenceKind) s.add(r.absenceKind);
  return s;
}
