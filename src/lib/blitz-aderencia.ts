/**
 * Análises da blitz de trajeto (LUIZ, 11/11/2026), num período escolhido
 * (mês, ano ou datas livres). Tudo sai de `seg_blitz_analise`, com a mesma
 * alçada: empresa inteira, ou a cadeia do Gestor.
 *
 * Aderência: do público, quem passou pelo menos uma vez no período. O público
 * é todo ativo, menos as funções marcadas como fora (entram por outro portão),
 * as exceções por pessoa e quem ficou ausente o período inteiro. Estrutura
 * (setor, gestor, função, unidade) é a de hoje.
 */
export type AderenciaGrupo = { nome: string; publico: number; passaram: number };

export type AderenciaFalta = {
  user_id: string;
  nome: string | null;
  matricula: string | null;
  funcao: string | null;
  setor: string | null;
  gestor: string | null;
  unidade: string | null;
  /** última blitz da pessoa em qualquer data (YYYY-MM-DD) */
  ultima: string | null;
};

/** Uma pessoa do público no período: a tela agrupa e filtra a partir daqui. */
export type AderenciaPessoa = {
  user_id: string;
  nome: string | null;
  matricula: string | null;
  funcao: string | null;
  setor: string | null;
  gestor: string | null;
  unidade: string | null;
  passou: boolean;
  /** última blitz da pessoa em qualquer data (YYYY-MM-DD) */
  ultima: string | null;
};

export type AderenciaDados = {
  publico: number;
  passaram: number;
  fora: { por_funcao: number; por_excecao: number; ausentes: number };
  por_setor: AderenciaGrupo[];
  por_gestor: AderenciaGrupo[];
  por_unidade: AderenciaGrupo[];
  por_funcao: AderenciaGrupo[];
  faltam: AderenciaFalta[];
  /** o público pessoa a pessoa (desde 11/11/2026; ausente em respostas antigas) */
  pessoas?: AderenciaPessoa[];
};

export type BlitzIndicadores = {
  total: number;
  conformes: number;
  com_desvio: number;
  bloqueios: number;
  colaboradores: number;
  alertas: { enviados: number; com_tratativa: number };
};

export type BlitzRecorrencia = {
  user_id: string;
  matricula?: string | null;
  nome: string | null;
  setor: string | null;
  /** da última blitz da pessoa no período */
  gestor?: string | null;
  unidade?: string | null;
  funcao?: string | null;
  nao_conformes: number;
  total: number;
};

/** Uma blitz do recorte, com o carimbo da época: a tela refaz os cartões com o filtro. */
export type BlitzItem = {
  id: string;
  /** quem foi abordado: a recorrência se refaz com o filtro de meio e situação */
  user_id?: string;
  setor: string | null;
  gestor: string | null;
  unidade: string | null;
  funcao: string | null;
  liberado: boolean;
  conforme: boolean;
  /** para "Principais falhas": o meio, o motivo do bloqueio e as perguntas */
  meio?: string | null;
  motivo?: string | null;
  /** perguntas respondidas com "não" */
  nao?: string[];
  /** perguntas feitas (sem os "não se aplica") */
  perguntadas?: string[];
};

/** Um alerta da blitz no período (`seg_blitz_alertas_do_periodo`), só leitura. */
export type BlitzAlertaAnalise = {
  id: string;
  enviado_em: string;
  occurred_on: string;
  colaborador: string | null;
  matricula?: string | null;
  setor: string | null;
  unidade: string | null;
  funcao?: string | null;
  /** o gestor alertado (o do colaborador no dia da blitz) */
  gestor: string | null;
  meio: string | null;
  liberado: boolean;
  motivo: string | null;
  observacao: string | null;
  respostas_nao: string[];
  tratativa_em: string | null;
  tratativa_resumo: string | null;
  tratativa_acordo: string | null;
  /** preenchido quando o gestor registrou a tratativa */
  registrada_em: string | null;
};

export type BlitzAnaliseDados = {
  de: string;
  ate: string;
  indicadores: BlitzIndicadores;
  aderencia: AderenciaDados;
  recorrencia: BlitzRecorrencia[];
  /** vem de uma segunda função, no mesmo recorte */
  alertas?: BlitzAlertaAnalise[];
  /** as blitz do recorte, uma a uma (o filtro da tela refaz os cartões com elas) */
  blitz?: BlitzItem[];
};

/** O cadastro do público, para Configurações > Segurança. */
export type BlitzPublicoConfig = {
  /** funções ativas, com quantas pessoas ativas há em cada uma */
  funcoes: { id: string; name: string; pessoas: number }[];
  funcoesFora: string[];
  excecoes: { userId: string; nome: string; participa: boolean }[];
};

export const pct = (ok: number, total: number) => (total > 0 ? Math.round((ok / total) * 100) : null);
