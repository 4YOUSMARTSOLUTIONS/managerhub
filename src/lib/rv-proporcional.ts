/**
 * Quanto do mês a pessoa efetivamente trabalhou, para a remuneração variável ser
 * proporcional.
 *
 * A RV era binária no tempo: ou existia vigência na competência e pagava o valor
 * cheio conforme o atingimento, ou não pagava nada. Um mês com 10 dias
 * trabalhados pagava igual a um mês inteiro.
 *
 * Fica fora do componente pelo mesmo motivo de `organograma.ts`: é a única parte
 * com decisão de verdade (quais dias contam) e, separada, se confere sem abrir o
 * navegador.
 *
 * A CONTAGEM É EM DIAS CORRIDOS, não em dias úteis. Julho tem 31 dias; quem
 * saiu de férias no dia 16 trabalhou 15. Fim de semana e feriado contam como dia
 * trabalhado, porque a RV é uma parcela do mês, não um pagamento por dia útil.
 *
 * Sem ausência e sem recorte de vínculo o fator é 1, e nada no valor muda.
 */

/** intervalo FECHADO nas duas pontas: o dia de início e o de fim são ausência */
export type AusenciaLite = { inicio: string; fim: string };
export type VinculoLite = { admissao: string | null; desligamento: string | null };
export type FatorRv = {
  /** dias do mês (28 a 31) */
  dias: number;
  /** dias em que a pessoa estava trabalhando */
  trabalhados: number;
  /** trabalhados / dias, entre 0 e 1 */
  fator: number;
};

const CHEIO: FatorRv = { dias: 0, trabalhados: 0, fator: 1 };

/** quantos dias um período cobre, contando as duas pontas (16/07 a 04/08 = 20) */
export function contarDias(inicio: string, fim: string): number {
  const a = Date.parse(`${inicio}T12:00:00Z`);
  const b = Date.parse(`${fim}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * `period` é a competência no formato `YYYY-MM-01`, o mesmo de
 * `individual_goal_entries.period`.
 *
 * Um dia NÃO é trabalhado quando cai em qualquer uma destas situações:
 *
 * - dentro de uma ausência que desconta RV;
 * - antes da admissão;
 * - depois do desligamento.
 *
 * Os dias são marcados num vetor em vez de somados por período, e é isso que
 * torna a conta imune a duplicidade: duas ausências que se cruzam, ou uma
 * ausência que invade o período pós-desligamento, marcam o mesmo dia duas vezes
 * e ele continua valendo um.
 *
 * As datas são comparadas como texto `YYYY-MM-DD`, que ordena igual à data. Sem
 * `new Date` na comparação, sem fuso, sem o dia virando o anterior às 21h.
 */
export function fatorRv(period: string, ausencias: AusenciaLite[], vinculo: VinculoLite): FatorRv {
  if (!/^\d{4}-\d{2}/.test(period)) return CHEIO;
  const ano = Number(period.slice(0, 4));
  const mes = Number(period.slice(5, 7));
  if (!(mes >= 1 && mes <= 12)) return CHEIO;

  // dia 0 do mês seguinte é o último dia deste
  const dias = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const aaaaMm = period.slice(0, 7);

  let trabalhados = 0;
  for (let d = 1; d <= dias; d++) {
    const iso = `${aaaaMm}-${String(d).padStart(2, "0")}`;
    if (vinculo.admissao && iso < vinculo.admissao) continue;
    if (vinculo.desligamento && iso > vinculo.desligamento) continue;
    if (ausencias.some((a) => iso >= a.inicio && iso <= a.fim)) continue;
    trabalhados += 1;
  }

  return { dias, trabalhados, fator: dias > 0 ? trabalhados / dias : 1 };
}
