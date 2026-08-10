/**
 * Resolução de "quem é esta linha" nas importações de planilha.
 *
 * As planilhas de férias, punições e RV identificam o alvo por DUAS colunas:
 * o nome (o que o humano lê e confere) e o ID (o que a máquina casa). A regra,
 * a mesma nas três importações e nas duas pontas (prévia do diálogo e action):
 *
 *   - ID preenchido e válido DECIDE. O nome vira conferência visual: um nome
 *     com typo ao lado de um ID válido não derruba a linha.
 *   - ID preenchido que não existe no cadastro recusa a linha (não encontrado),
 *     sem cair para o nome: um ID errado é sinal de linha desalinhada, e casar
 *     pelo nome esconderia exatamente o erro que a coluna veio prevenir.
 *   - ID e nome apontando para pessoas DIFERENTES recusa como divergente. É o
 *     erro clássico de arrastar a célula de ID no Excel e desalinhar as linhas.
 *   - Sem ID, vale o casamento por nome normalizado de sempre (planilha antiga
 *     continua funcionando).
 *
 * O ID resolve o que o nome não consegue: homônimos. Dois colaboradores com o
 * mesmo nome são indistinguíveis por texto, e o casamento por nome escolhia um
 * deles em silêncio.
 */

import { normTexto } from "@/lib/absences-import";

export type IndiceDeAlvos = {
  /** chave minúscula → id como está no cadastro + nome normalizado */
  porId: Map<string, { id: string; nome: string }>;
  idPorNome: Map<string, string>;
};

/** Vale para colaboradores E para funções: qualquer catálogo `{id, name}`. */
export function indiceDeAlvos(refs: { id: string; name: string }[]): IndiceDeAlvos {
  const porId = new Map<string, { id: string; nome: string }>();
  const idPorNome = new Map<string, string>();
  for (const r of refs) {
    const nome = normTexto(r.name ?? "");
    porId.set(r.id.toLowerCase(), { id: r.id, nome });
    if (nome) idPorNome.set(nome, r.id);
  }
  return { porId, idPorNome };
}

export type AlvoDaLinha = {
  /** id resolvido (grafia do cadastro), ou null quando a linha foi recusada */
  alvoId: string | null;
  naoEncontrado: boolean;
  divergente: boolean;
};

export function resolverAlvo(idBruto: string, nomeBruto: string, idx: IndiceDeAlvos): AlvoDaLinha {
  const idLido = (idBruto ?? "").trim().toLowerCase();
  const nome = normTexto(nomeBruto ?? "");
  if (idLido) {
    const alvo = idx.porId.get(idLido);
    if (!alvo) return { alvoId: null, naoEncontrado: true, divergente: false };
    // divergente só quando o nome escrito existe no cadastro E não é o do ID;
    // nome com typo (não existe em lugar nenhum) não condena um ID válido
    if (nome && nome !== alvo.nome && idx.idPorNome.has(nome)) {
      return { alvoId: null, naoEncontrado: false, divergente: true };
    }
    return { alvoId: alvo.id, naoEncontrado: false, divergente: false };
  }
  const porNome = nome ? idx.idPorNome.get(nome) : undefined;
  if (!porNome) return { alvoId: null, naoEncontrado: !!nome, divergente: false };
  return { alvoId: porNome, naoEncontrado: false, divergente: false };
}
