/**
 * O efeito de um lançamento de absenteísmo na remuneração variável, em
 * palavras (LUIZ, 16/11/2026).
 *
 * Substitui o "Desconta RV: Sim/Não", que só dizia se o dia sai da conta
 * PROPORCIONAL. Atestado e falta não descontam no proporcional, mas cortam pela
 * faixa do redutor (a soma dos dias do mês), e o "Não" fazia parecer que não
 * pesavam. Mesma precedência do cálculo da RV e do aviso do formulário: motivo
 * com faixa de redutor ativa é cobrado SÓ pela faixa; senão, o proporcional do
 * catálogo; senão, nada.
 *
 * Não diz a porcentagem: ela depende da soma dos dias do mês inteiro, e por
 * lançamento enganaria (três atestados de 1 dia são 20% cada sozinhos, e 50%
 * somados).
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

export function efeitoNaRv(l: EntradaEfeitoRv, kindsComRedutor: readonly string[]): string {
  if (l.status === "cancelado") return "Nenhum (cancelado)";
  if (l.status === "reprovado") return "Nenhum (reprovado)";
  if (!l.kind) return "A definir (sem motivo)";

  let efeito: string;
  if (l.horas) efeito = "Nenhum (ausência de horas)";
  else if (l.abonada) efeito = "Nenhum (abonada)";
  else if (kindsComRedutor.includes(l.kind)) efeito = "Redutor por faixa (soma do mês)";
  else if (l.descontaRv) efeito = "Proporcional aos dias";
  else efeito = "Nenhum";

  // só passa a valer quando o RH aprova
  return l.status === "aprovado" || efeito.startsWith("Nenhum") ? efeito : `${efeito}, após aprovação`;
}
