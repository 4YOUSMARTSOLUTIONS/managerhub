/**
 * Resolução de "quem é esta linha" nas importações de planilha.
 *
 * As planilhas de férias, punições e RV identificam o colaborador por DUAS
 * colunas: o nome (o que o humano lê e confere) e o ID, que é a MATRÍCULA do
 * cadastro (`memberships.employee_code`), nunca o id interno do banco, que o
 * usuário não conhece. A regra, a mesma nas três importações e nas duas pontas
 * (prévia do diálogo e action):
 *
 *   - Matrícula preenchida e válida DECIDE. O nome vira conferência visual: um
 *     nome com typo ao lado de uma matrícula válida não derruba a linha.
 *   - Matrícula que não existe recusa a linha (não encontrado), sem cair para o
 *     nome: matrícula errada é sinal de planilha desalinhada, e casar pelo nome
 *     esconderia exatamente o erro que a coluna veio prevenir.
 *   - Matrícula e nome apontando para pessoas DIFERENTES recusa como
 *     divergente. É o erro clássico de arrastar a célula no Excel.
 *   - Sem matrícula, vale o casamento por nome normalizado de sempre (planilha
 *     antiga continua funcionando; colaborador sem matrícula também).
 *   - Matrícula repetida no cadastro não decide nada: sai do índice e as linhas
 *     dela caem no casamento por nome, em vez de escolher alguém em silêncio.
 *
 * A matrícula resolve o que o nome não consegue: homônimos.
 */

import { normTexto } from "@/lib/absences-import";

/** "0123", "123" e " 123 " são a MESMA matrícula: o Excel come zeros à esquerda */
export const normMatricula = (s: string): string => {
  const t = (s ?? "").trim().toLowerCase();
  return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, "") : t;
};

export type IndiceDeAlvos = {
  porMatricula: Map<string, { id: string; nome: string }>;
  idPorNome: Map<string, string>;
};

export function indiceDeAlvos(refs: { id: string; name: string; code?: string | null }[]): IndiceDeAlvos {
  const porMatricula = new Map<string, { id: string; nome: string }>();
  const repetidas = new Set<string>();
  const idPorNome = new Map<string, string>();
  for (const r of refs) {
    const nome = normTexto(r.name ?? "");
    if (nome) idPorNome.set(nome, r.id);
    const mat = normMatricula(r.code ?? "");
    if (!mat) continue;
    if (porMatricula.has(mat)) repetidas.add(mat);
    porMatricula.set(mat, { id: r.id, nome });
  }
  for (const mat of repetidas) porMatricula.delete(mat);
  return { porMatricula, idPorNome };
}

export type AlvoDaLinha = {
  /** id interno resolvido (o que as tabelas gravam), ou null quando recusada */
  alvoId: string | null;
  naoEncontrado: boolean;
  divergente: boolean;
};

export function resolverAlvo(matriculaBruta: string, nomeBruto: string, idx: IndiceDeAlvos): AlvoDaLinha {
  const mat = normMatricula(matriculaBruta ?? "");
  const nome = normTexto(nomeBruto ?? "");
  if (mat) {
    const alvo = idx.porMatricula.get(mat);
    if (!alvo) return { alvoId: null, naoEncontrado: true, divergente: false };
    // divergente só quando o nome escrito existe no cadastro E não é o do dono
    // da matrícula; nome com typo não condena uma matrícula válida
    if (nome && nome !== alvo.nome && idx.idPorNome.has(nome)) {
      return { alvoId: null, naoEncontrado: false, divergente: true };
    }
    return { alvoId: alvo.id, naoEncontrado: false, divergente: false };
  }
  const porNome = nome ? idx.idPorNome.get(nome) : undefined;
  if (!porNome) return { alvoId: null, naoEncontrado: !!nome, divergente: false };
  return { alvoId: porNome, naoEncontrado: false, divergente: false };
}
