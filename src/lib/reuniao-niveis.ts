/**
 * Participantes de reunião por hierarquia: o que o formulário e o follow usam
 * para saber quem está em cada nível, nas unidades da reunião. Quem decide a
 * lista gravada é o banco (`sincronizar_participantes_nivel`), com a mesma regra.
 */
export type NiveisDeReuniao = {
  niveis: { id: string; nome: string; ativo: boolean }[];
  pessoas: { id: string; nivel: string; unidades: string[] }[];
};

/** Acima disto pede confirmação: marcar Operacional sem querer convidaria centenas. */
export const LIMITE_SEM_CONFIRMAR = 30;

export function pessoasDosNiveis(dados: NiveisDeReuniao | null, niveis: string[], unidades: string[]): string[] {
  if (!dados || niveis.length === 0 || unidades.length === 0) return [];
  const n = new Set(niveis);
  const u = new Set(unidades);
  const ids = new Set<string>();
  for (const p of dados.pessoas) {
    if (n.has(p.nivel) && p.unidades.some((x) => u.has(x))) ids.add(p.id);
  }
  return [...ids];
}

/** Os níveis que têm alguém nas unidades, na ordem da hierarquia. */
export function niveisComPessoas(dados: NiveisDeReuniao | null, unidades: string[]) {
  if (!dados) return [];
  const u = new Set(unidades);
  const porNivel = new Map<string, Set<string>>();
  for (const p of dados.pessoas) {
    if (!p.unidades.some((x) => u.has(x))) continue;
    const ids = porNivel.get(p.nivel) ?? new Set<string>();
    ids.add(p.id);
    porNivel.set(p.nivel, ids);
  }
  return dados.niveis
    .filter((n) => porNivel.has(n.id))
    .map((n) => ({ ...n, pessoas: [...(porNivel.get(n.id) ?? [])] }));
}
