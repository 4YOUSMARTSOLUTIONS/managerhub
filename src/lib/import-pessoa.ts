/**
 * Resolução de "quem é esta linha" nas importações de planilha.
 *
 * A chave é UNIDADE + MATRÍCULA (`memberships.employee_code` + as unidades do
 * vínculo). Casamento por NOME não existe: nome é coluna informativa, para o
 * humano conferir, e o sistema o ignora por decisão de produto: nome permite
 * erro (typo, homônimo), identificador não.
 *
 * A regra, a mesma nas três importações e nas duas pontas (prévia e action):
 *
 *   - Empresa com UMA única unidade: a matrícula resolve sozinha. Se a linha
 *     trouxer Unidade, ela é conferida mesmo assim.
 *   - Empresa com MAIS de uma unidade: a coluna Unidade é obrigatória em toda
 *     linha, e o casamento é estrito por (unidade, matrícula). Matrícula
 *     sozinha não resolve nem quando é única na empresa: o SaaS não sabe se a
 *     empresa repete matrícula entre unidades, então não aposta.
 *   - Linha sem matrícula é inválida. Não há fallback.
 *   - Matrícula duplicada DENTRO da mesma unidade não resolve nunca: é defeito
 *     de cadastro, e a recusa aponta isso.
 *
 * Toda recusa carrega um `motivo`, e `MOTIVO_LABEL` é o texto do selo na
 * prévia: a pessoa vê POR QUE a linha não entra, não um "não encontrado"
 * genérico.
 */

import { normTexto } from "@/lib/absences-import";

/** "0123", "123" e " 123 " são a MESMA matrícula: o Excel come zeros à esquerda */
export const normMatricula = (s: string): string => {
  const t = (s ?? "").trim().toLowerCase();
  return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, "") : t;
};

export type MotivoDeRecusa =
  | "sem_matricula"
  | "precisa_unidade"
  | "nao_encontrada"
  | "unidade_nao_confere"
  | "duplicada_na_unidade";

export const MOTIVO_LABEL: Record<MotivoDeRecusa, string> = {
  sem_matricula: "sem matrícula",
  precisa_unidade: "informe a Unidade",
  nao_encontrada: "matrícula não encontrada",
  unidade_nao_confere: "unidade não confere",
  duplicada_na_unidade: "matrícula duplicada no cadastro",
};

export type IndiceDeAlvos = {
  /** matrícula normalizada → TODOS os donos, com as unidades de cada um (norm) */
  porMatricula: Map<string, { id: string; unidades: string[] }[]>;
  /** a empresa tem mais de uma unidade? decide se a coluna Unidade é obrigatória */
  multiUnidade: boolean;
};

export function indiceDeAlvos(
  refs: { id: string; code?: string | null; units?: string[] }[],
  unidadesDaEmpresa: string[],
): IndiceDeAlvos {
  const porMatricula = new Map<string, { id: string; unidades: string[] }[]>();
  for (const r of refs) {
    const mat = normMatricula(r.code ?? "");
    if (!mat) continue;
    const arr = porMatricula.get(mat) ?? [];
    arr.push({ id: r.id, unidades: (r.units ?? []).map(normTexto).filter(Boolean) });
    porMatricula.set(mat, arr);
  }
  return { porMatricula, multiUnidade: unidadesDaEmpresa.length > 1 };
}

export type AlvoDaLinha = {
  /** id interno resolvido (o que as tabelas gravam), ou null quando recusada */
  alvoId: string | null;
  motivo: MotivoDeRecusa | null;
};

const alvo = (id: string): AlvoDaLinha => ({ alvoId: id, motivo: null });
const recusa = (motivo: MotivoDeRecusa): AlvoDaLinha => ({ alvoId: null, motivo });

export function resolverAlvo(matriculaBruta: string, unidadeBruta: string, idx: IndiceDeAlvos): AlvoDaLinha {
  const mat = normMatricula(matriculaBruta ?? "");
  const unidade = normTexto(unidadeBruta ?? "");
  if (!mat) return recusa("sem_matricula");
  if (idx.multiUnidade && !unidade) return recusa("precisa_unidade");

  const donos = idx.porMatricula.get(mat) ?? [];
  if (donos.length === 0) return recusa("nao_encontrada");

  // com Unidade na linha (obrigatória em empresa multiunidade, opcional na de
  // unidade única), ela restringe: dono sem a unidade citada está fora
  const candidatos = unidade ? donos.filter((d) => d.unidades.includes(unidade)) : donos;
  if (candidatos.length === 1) return alvo(candidatos[0].id);
  if (candidatos.length === 0) return recusa("unidade_nao_confere");
  return recusa("duplicada_na_unidade");
}
