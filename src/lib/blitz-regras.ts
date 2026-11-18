/**
 * As regras da blitz de cada empresa (LUIZ, 18/11/2026), em
 * Configurações > Segurança > Regras da blitz (`seg_settings`).
 *
 *  - Educativa: a primeira blitz da vida de quem foi contratado a partir de
 *    uma data. Aparece nos Registros, mas fica fora de toda a conta (aderência,
 *    qualidade, recorrência) e não abre tratativa. A marca é carimbada na
 *    blitz pelo banco, então mudar a regra não reescreve o passado.
 *  - Tratativa: a cada blitz não conforme (como era) ou por recorrência, quando
 *    a pessoa chega a N blitz não conformes em D dias. O bloqueio pode
 *    continuar abrindo na hora. Quem decide é o banco (`seg_blitz_acionar`);
 *    aqui fica só o que a tela precisa para explicar.
 */
export type BlitzModoTratativa = "ocorrencia" | "recorrencia";

export type BlitzRegras = {
  educativaAtiva: boolean;
  /** YYYY-MM-DD: contratados a partir desta data */
  educativaDesde: string;
  modo: BlitzModoTratativa;
  qtd: number;
  dias: number;
  bloqueioImediato: boolean;
};

/** O que vale enquanto a empresa não mexeu nas regras (os padrões do banco). */
export const REGRAS_PADRAO: BlitzRegras = {
  educativaAtiva: false,
  educativaDesde: "2026-11-01",
  modo: "ocorrencia",
  qtd: 3,
  dias: 180,
  bloqueioImediato: true,
};

export const LIMITES_DA_RECORRENCIA = { qtd: { min: 2, max: 20 }, dias: { min: 7, max: 730 } } as const;

type LinhaDeRegras = {
  blitz_educativa_ativa: boolean;
  blitz_educativa_desde: string;
  blitz_tratativa_modo: BlitzModoTratativa;
  blitz_recorrencia_qtd: number;
  blitz_recorrencia_dias: number;
  blitz_bloqueio_imediato: boolean;
};

/** A linha de `seg_settings` (ou a falta dela) nas regras da tela. */
export function regrasDaLinha(linha: LinhaDeRegras | null | undefined): BlitzRegras {
  if (!linha) return REGRAS_PADRAO;
  return {
    educativaAtiva: linha.blitz_educativa_ativa,
    educativaDesde: linha.blitz_educativa_desde,
    modo: linha.blitz_tratativa_modo,
    qtd: linha.blitz_recorrencia_qtd,
    dias: linha.blitz_recorrencia_dias,
    bloqueioImediato: linha.blitz_bloqueio_imediato,
  };
}

/** A blitz não conforme abre tratativa na hora, por esta regra? */
export function abreNaHora(regras: BlitzRegras, bloqueio: boolean): boolean {
  return regras.modo === "ocorrencia" || (bloqueio && regras.bloqueioImediato);
}

/** "3 blitz não conformes em 180 dias" */
export function textoDaRecorrencia(regras: BlitzRegras): string {
  return `${regras.qtd} blitz não conformes em ${regras.dias} dias`;
}
