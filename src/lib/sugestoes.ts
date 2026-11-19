/**
 * Sugestões (LUIZ, 18/11/2026): peças que o servidor e a tela compartilham.
 * Sem "use server" e sem JSX.
 */
import type { Enums } from "@/types/database";
import type { Tone } from "@/lib/constants";

export type SugestaoStatus = Enums<"sugestao_status">;

export const BUCKET_SUGESTOES = "sugestoes";
export const TAMANHO_PRINT_SUGESTAO = 5 * 1024 * 1024;
export const MIMES_PRINT_SUGESTAO = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const MAX_PRINTS_SUGESTAO = 3;

export const STATUS_SUGESTAO: Record<SugestaoStatus, string> = {
  nova: "Nova",
  em_analise: "Em análise",
  planejada: "Planejada",
  em_desenvolvimento: "Em desenvolvimento",
  entregue: "Entregue",
  recusada: "Recusada",
  duplicada: "Duplicada",
};

export const STATUS_SUGESTAO_TONE: Record<SugestaoStatus, Tone> = {
  nova: "blue",
  em_analise: "amber",
  planejada: "purple",
  em_desenvolvimento: "pink",
  entregue: "green",
  recusada: "red",
  duplicada: "gray",
};

/** A ordem da triagem, para o seletor. */
export const ORDEM_STATUS: SugestaoStatus[] = [
  "nova", "em_analise", "planejada", "em_desenvolvimento", "entregue", "recusada", "duplicada",
];

export type AbaSugestoes = "abertas" | "entregues" | "minhas" | "encerradas";

export function abaDoStatus(s: SugestaoStatus): Exclude<AbaSugestoes, "minhas"> {
  if (s === "entregue") return "entregues";
  if (s === "recusada" || s === "duplicada") return "encerradas";
  return "abertas";
}

/** Encerrada não recebe curtida (o banco recusa também). */
export const aceitaCurtida = (s: SugestaoStatus) => s !== "recusada" && s !== "duplicada";

export type Sugestao = {
  id: string;
  titulo: string;
  descricao: string;
  modulo: string | null;
  imagens: string[];
  status: SugestaoStatus;
  statusEm: string;
  resposta: string | null;
  respostaEm: string | null;
  respostaPorNome: string | null;
  duplicadaDe: string | null;
  artigoSlug: string | null;
  oculta: boolean;
  ocultaMotivo: string | null;
  curtidas: number;
  comentarios: number;
  autorId: string | null;
  autorNome: string;
  empresaNome: string;
  createdAt: string;
  /** curtidas dos últimos 30 dias ("em alta") */
  curtidas30d: number;
  /** a pessoa logada curtiu */
  curti: boolean;
  /** a pessoa logada segue (sugeriu, curtiu ou comentou, e não deixou de seguir) */
  sigo: boolean;
};

export type ComentarioSugestao = {
  id: string;
  autorId: string | null;
  autorNome: string;
  empresaNome: string;
  texto: string | null;
  oculto: boolean;
  editadoEm: string | null;
  createdAt: string;
};

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** palavras que contam para achar parecidas: 4 letras ou mais */
function palavras(s: string): Set<string> {
  return new Set(normalizar(s).split(/[^a-z0-9]+/).filter((p) => p.length >= 4));
}

/**
 * Sugestões parecidas com o título que está sendo digitado, para a pessoa
 * curtir a que já existe em vez de duplicar. Conta palavras em comum entre o
 * título digitado e o título + descrição de cada sugestão aberta ou entregue.
 */
export function parecidas(titulo: string, todas: Sugestao[], ignorar?: string): Sugestao[] {
  const alvo = palavras(titulo);
  if (alvo.size === 0) return [];
  return todas
    .filter((s) => s.id !== ignorar && s.status !== "duplicada" && s.status !== "recusada" && !s.oculta)
    .map((s) => {
      const delas = palavras(`${s.titulo} ${s.descricao}`);
      let comum = 0;
      for (const p of alvo) if (delas.has(p)) comum += 1;
      return { s, comum };
    })
    .filter((x) => x.comum >= Math.min(2, alvo.size))
    .sort((a, b) => b.comum - a.comum || b.s.curtidas - a.s.curtidas)
    .slice(0, 3)
    .map((x) => x.s);
}
