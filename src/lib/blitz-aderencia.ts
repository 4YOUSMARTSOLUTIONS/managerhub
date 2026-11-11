/**
 * Aderência à blitz de trajeto (LUIZ, 11/11/2026): do público do mês, quem
 * passou pelo menos uma vez. O público é todo ativo, menos as funções marcadas
 * como fora (entram por outro portão), as exceções por pessoa e quem ficou
 * ausente o mês inteiro. Cálculo em `seg_blitz_aderencia`; estrutura de hoje.
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
  /** última blitz da pessoa em qualquer mês (YYYY-MM-DD) */
  ultima: string | null;
};

export type BlitzAderencia = {
  mes: string; // YYYY-MM
  de: string;
  ate: string;
  publico: number;
  passaram: number;
  fora: { por_funcao: number; por_excecao: number; ausentes: number };
  por_setor: AderenciaGrupo[];
  por_gestor: AderenciaGrupo[];
  por_unidade: AderenciaGrupo[];
  por_funcao: AderenciaGrupo[];
  faltam: AderenciaFalta[];
};

/** O cadastro do público, para o diálogo de configuração. */
export type BlitzPublicoConfig = {
  /** funções ativas, com quantas pessoas ativas há em cada uma */
  funcoes: { id: string; name: string; pessoas: number }[];
  funcoesFora: string[];
  excecoes: { userId: string; nome: string; participa: boolean }[];
};

export const pct = (ok: number, total: number) => (total > 0 ? Math.round((ok / total) * 100) : null);
