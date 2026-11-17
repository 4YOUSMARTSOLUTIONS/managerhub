/**
 * O efeito de um lançamento de absenteísmo na remuneração variável (LUIZ,
 * 16/11/2026): "Sim", "Não" ou "A definir (aguardando efetivação)".
 *
 * Substitui o "Desconta RV: Sim/Não", que só dizia se o dia sai da conta
 * PROPORCIONAL. Atestado, afastamento, licença e falta não descontam no
 * proporcional, mas cortam pela faixa do redutor (a soma dos dias do mês), e o
 * "Não" fazia parecer que não pesavam. Mesma precedência do cálculo da RV:
 * motivo com faixa de redutor ativa pesa pela faixa; senão, pelo proporcional
 * do catálogo; senão, não pesa.
 *
 * Só três respostas, a pedido do LUIZ (17/11/2026): o detalhe (faixa ou
 * proporcional) não ajudava quem lê a planilha. Não diz a porcentagem: ela
 * depende da soma dos dias do mês inteiro, e por lançamento enganaria.
 *
 * "A definir" é o lançamento em aberto: o motivo só chega no Efetivar. Depois
 * dele a resposta já vale, e a coluna Situação mostra se o RH ainda vai decidir.
 *
 * Mora fora de `"use server"`: a tela (lista, ficha, planilha do gestor) e a
 * action do relatório usam a mesma regra.
 */

import type { Enums } from "@/types/database";

export type EntradaEfeitoRv = {
  status: Enums<"absenteismo_status">;
  /** comportamento do motivo; nulo = ainda sem motivo */
  kind: Enums<"absence_kind"> | null;
  /** desconto proporcional definido no catálogo para o motivo */
  descontaRv: boolean | null;
  abonada: boolean;
  /** ausência de horas: não vira dia de ausência (o desconto é na folha) */
  horas: boolean;
};

export type EfeitoRv = "Sim" | "Não" | "A definir (aguardando efetivação)";

export function efeitoNaRv(l: EntradaEfeitoRv, kindsComRedutor: readonly string[]): EfeitoRv {
  if (l.status === "cancelado" || l.status === "reprovado") return "Não";
  if (l.status === "aberto" || !l.kind) return "A definir (aguardando efetivação)";
  if (l.horas || l.abonada) return "Não";
  if (kindsComRedutor.includes(l.kind)) return "Sim";
  return l.descontaRv ? "Sim" : "Não";
}
