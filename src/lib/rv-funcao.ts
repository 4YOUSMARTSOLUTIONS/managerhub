/**
 * O valor cheio da remuneração variável quando a função muda no meio do mês.
 *
 * A RV é configurada por função (ou por colaborador). Antes, o mês inteiro era
 * pago pela função ATUAL: quem foi auxiliar até o dia 15 e analista a partir do
 * 16 recebia o mês todo como analista, e uma promoção registrada depois mudava
 * os meses anteriores ainda abertos.
 *
 * Regra combinada com o LUIZ (09/11/2026): o valor cheio do mês é a soma de
 * cada função pelos dias em que ela valeu. Auxiliar R$ 300 por 15 dias e
 * analista R$ 600 por 15 dias, num mês de 30, dá R$ 450. Depois entram os
 * descontos que já existiam (`fatorRv` e `redutoresDoMes`), sem mudança.
 *
 * Os dias pesados são os do VÍNCULO no mês (da admissão ao desligamento). O
 * corte de quem entrou ou saiu no meio do mês já é feito pelo `fatorRv`; pesar
 * aqui pelo mês inteiro cobraria esse corte duas vezes.
 *
 * A função de cada dia vem de `membership_history`, o histórico com data que a
 * ficha e a importação gravam. Fica fora dos componentes, como
 * `rv-proporcional.ts`, porque a tela de metas e o fechamento da competência
 * precisam chegar ao MESMO número.
 *
 * Datas como texto `YYYY-MM-DD`, comparadas como texto, sem `new Date` e sem
 * fuso, como em `rv-proporcional.ts`.
 */
import type { VinculoLite } from "@/lib/rv-proporcional";

export type CfgRv = {
  scope: string;
  position_id: string | null;
  user_id: string | null;
  /** competência de início, `YYYY-MM-01` */
  effective_from: string;
  value: number | string;
};

/** um período com a mesma função; `fim` é EXCLUSIVO (o dia em que a próxima começa) */
export type TrechoFuncao = { inicio: string; fim: string | null; positionId: string | null };

export type HistoricoFuncaoRow = {
  effective_from: string;
  effective_to: string | null;
  position_id: string | null;
};

/**
 * Valor configurado para a pessoa numa competência: a última vigência <= o mês,
 * com o valor do colaborador ganhando do valor da função. Sem nada, zero.
 */
export function poteVigente(cfgs: CfgRv[], userId: string, positionId: string | null, period: string): number {
  const ultimo = (escopo: "user" | "position") => {
    let best: CfgRv | null = null;
    for (const c of cfgs) {
      if (c.scope !== escopo) continue;
      if (escopo === "user" ? c.user_id !== userId : c.position_id !== positionId) continue;
      if (c.effective_from <= period && (!best || c.effective_from > best.effective_from)) best = c;
    }
    return best;
  };
  const u = ultimo("user");
  if (u) return Number(u.value);
  const p = positionId ? ultimo("position") : null;
  return p ? Number(p.value) : 0;
}

/**
 * Vigências do histórico viram trechos de FUNÇÃO: o histórico abre vigência por
 * qualquer mudança (gestor, setor...), e duas vigências seguidas com a mesma
 * função são um trecho só.
 */
export function trechosDeFuncao(hist: HistoricoFuncaoRow[]): TrechoFuncao[] {
  const ordenado = [...hist].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const out: TrechoFuncao[] = [];
  for (const h of ordenado) {
    const inicio = h.effective_from.slice(0, 10);
    const fim = h.effective_to ? h.effective_to.slice(0, 10) : null;
    const ult = out[out.length - 1];
    if (ult && ult.positionId === h.position_id) {
      ult.fim = fim;
    } else {
      out.push({ inicio, fim, positionId: h.position_id });
    }
  }
  return out;
}

const mesSeguinte = (periodo: string) => {
  const ano = Number(periodo.slice(0, 4));
  const mes = Number(periodo.slice(5, 7));
  return mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
};

/** quantos dias do mês cada função valeu, dentro do vínculo */
export function diasPorFuncao(
  period: string, trechos: TrechoFuncao[], vinculo: VinculoLite,
): Map<string | null, number> {
  const dias = new Map<string | null, number>();
  if (trechos.length === 0 || !/^\d{4}-\d{2}/.test(period)) return dias;
  const ano = Number(period.slice(0, 4));
  const mes = Number(period.slice(5, 7));
  const total = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const aaaaMm = period.slice(0, 7);
  for (let d = 1; d <= total; d++) {
    const iso = `${aaaaMm}-${String(d).padStart(2, "0")}`;
    if (vinculo.admissao && iso < vinculo.admissao) continue;
    if (vinculo.desligamento && iso > vinculo.desligamento) continue;
    // dia fora de qualquer trecho (histórico que começa depois da admissão)
    // fica com a função do trecho mais próximo
    const t = trechos.find((x) => x.inicio <= iso && (x.fim === null || iso < x.fim))
      ?? (iso < trechos[0].inicio ? trechos[0] : trechos[trechos.length - 1]);
    dias.set(t.positionId, (dias.get(t.positionId) ?? 0) + 1);
  }
  return dias;
}

/**
 * O valor cheio do mês, com as funções pesadas pelos dias. Sem histórico (ou
 * mês todo fora do vínculo), vale a função atual, como antes.
 */
export function poteDoMes(
  period: string, userId: string, trechos: TrechoFuncao[], cfgs: CfgRv[],
  vinculo: VinculoLite, positionAtual: string | null,
): number {
  const dias = diasPorFuncao(period, trechos, vinculo);
  let total = 0;
  for (const n of dias.values()) total += n;
  if (total === 0) return poteVigente(cfgs, userId, positionAtual, period);
  let soma = 0;
  for (const [pos, n] of dias) soma += poteVigente(cfgs, userId, pos, period) * n;
  return Math.round((soma / total) * 100) / 100;
}

/**
 * A linha do tempo que a tela de metas recebe: um ponto em cada mês em que o
 * valor pode mudar (nova vigência de valor, o mês de uma troca de função e o
 * seguinte). Entre dois pontos o valor não muda, e a tela pega o último ponto
 * <= competência. Sem nenhum valor configurado para a pessoa, lista vazia.
 */
export function linhaDoTempoRv(
  userId: string, trechos: TrechoFuncao[], cfgs: CfgRv[],
  vinculo: VinculoLite, positionAtual: string | null,
): { from: string; value: number }[] {
  const funcoes = new Set<string | null>([positionAtual, ...trechos.map((t) => t.positionId)]);
  const relevantes = cfgs.filter((c) =>
    (c.scope === "user" && c.user_id === userId)
    || (c.scope === "position" && c.position_id !== null && funcoes.has(c.position_id)));
  if (relevantes.length === 0) return [];

  const pontos = new Set(relevantes.map((c) => `${c.effective_from.slice(0, 7)}-01`));
  // o primeiro trecho começa na admissão; troca de função é do segundo em diante
  for (const t of trechos.slice(1)) {
    const mes = `${t.inicio.slice(0, 7)}-01`;
    pontos.add(mes);
    pontos.add(mesSeguinte(mes));
  }
  return [...pontos].sort().map((from) => ({
    from,
    value: poteDoMes(from, userId, trechos, cfgs, vinculo, positionAtual),
  }));
}
