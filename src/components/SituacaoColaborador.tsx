"use client";

import { Badge } from "@/components/ui/Badge";
import { SITUACAO_COLABORADOR } from "@/lib/constants";
import { formatDate } from "@/lib/format";

/**
 * Situação do colaborador fora do trabalho normal (aposentadoria por
 * invalidez, afastado pelo INSS, licença-maternidade...). Sem situação = "Ativo".
 *
 * Ninguém digita a situação: ela é CALCULADA do afastamento ou da licença em
 * vigor hoje (`colaboradores_situacoes` e `ferias_painel`). Para mudar, lança-se
 * ou encerra-se o afastamento em Configurações > Absenteísmos e afastamentos.
 */
export type SituacaoColaborador = {
  /** motivo do afastamento, ou o tipo ("afastamento", "licenca") sem motivo */
  situacao: string;
  desde: string | null;
  /** nulo = sem data de retorno */
  retorno: string | null;
  observacao: string | null;
};

export function rotuloSituacao(s: SituacaoColaborador | null | undefined): string {
  if (!s) return "Ativo";
  return SITUACAO_COLABORADOR[s.situacao] ?? s.situacao;
}

/** o complemento que não cabe na pílula: desde quando, até quando, observação */
export function detalheSituacao(s: SituacaoColaborador | null | undefined): string {
  if (!s) return "";
  const partes: string[] = [];
  if (s.desde) partes.push(`Desde ${formatDate(s.desde)}`);
  partes.push(s.retorno ? `Retorno em ${formatDate(s.retorno)}` : "Sem data de retorno");
  if (s.observacao) partes.push(s.observacao);
  return partes.join(". ");
}

/**
 * A pílula da situação. Fala baixo (quiet): é cadastro, não pede ação, e a
 * linha costuma já ter a pílula tintada dela (DESIGN.md).
 */
export function SituacaoBadge({ situacao }: { situacao: SituacaoColaborador | null | undefined }) {
  if (!situacao) return <Badge variant="quiet" tone="gray">Ativo</Badge>;
  return (
    <span title={detalheSituacao(situacao)}>
      <Badge variant="quiet" tone="purple">{rotuloSituacao(situacao)}</Badge>
    </span>
  );
}
