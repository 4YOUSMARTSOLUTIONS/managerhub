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

export type AderenciaDados = {
  publico: number;
  passaram: number;
  fora: { por_funcao: number; por_excecao: number; ausentes: number };
  por_setor: AderenciaGrupo[];
  por_gestor: AderenciaGrupo[];
  por_unidade: AderenciaGrupo[];
  por_funcao: AderenciaGrupo[];
  faltam: AderenciaFalta[];
};

export type BlitzIndicadores = {
  total: number;
  conformes: number;
  com_desvio: number;
  bloqueios: number;
  colaboradores: number;
  alertas: { enviados: number; com_tratativa: number };
};

export type BlitzRecorrencia = { user_id: string; nome: string | null; setor: string | null; nao_conformes: number; total: number };

export type BlitzAnaliseDados = {
  de: string;
  ate: string;
  indicadores: BlitzIndicadores;
  aderencia: AderenciaDados;
  recorrencia: BlitzRecorrencia[];
};

/** O cadastro do público, para Configurações > Segurança. */
export type BlitzPublicoConfig = {
  /** funções ativas, com quantas pessoas ativas há em cada uma */
  funcoes: { id: string; name: string; pessoas: number }[];
  funcoesFora: string[];
  excecoes: { userId: string; nome: string; participa: boolean }[];
};

export const pct = (ok: number, total: number) => (total > 0 ? Math.round((ok / total) * 100) : null);
