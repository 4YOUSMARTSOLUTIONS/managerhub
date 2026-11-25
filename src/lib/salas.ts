/**
 * Salas de reunião por unidade (LUIZ, 25/11/2026): a matriz tem umas salas, a
 * filial outras. Módulo neutro (sem "use server" nem "use client"): as páginas
 * montam a lista e os formulários recortam.
 */

/** O mínimo que um seletor de sala precisa saber da unidade. */
export type SalaDaUnidade = {
  id: string;
  name: string;
  /** nula na sala antiga, ainda sem unidade definida */
  unitId?: string | null;
  /** só preenchida quando a empresa tem mais de uma unidade: vira o sufixo do nome */
  unitName?: string | null;
};

/**
 * As salas que servem às unidades escolhidas: as delas e as ainda sem unidade
 * (que aparecem em qualquer uma até o admin definir). Sem unidade escolhida,
 * todas. A sala já escolhida (`manter`) fica sempre, mesmo de outra unidade:
 * editar uma reunião antiga não pode apagar a sala dela em silêncio.
 */
export function salasDasUnidades<T extends SalaDaUnidade>(salas: T[], unidades: string[], manter?: string | null): T[] {
  if (unidades.length === 0) return salas;
  const escolhidas = new Set(unidades);
  return salas.filter((s) => !s.unitId || escolhidas.has(s.unitId) || s.id === manter);
}

/** "Principal · MATRIZ" quando há mais de uma unidade; senão só o nome. */
export function rotuloDaSala(s: SalaDaUnidade): string {
  return s.unitName ? `${s.name} · ${s.unitName}` : s.name;
}

/**
 * Monta a lista para os seletores a partir das linhas de `rooms`: o nome da
 * unidade só vem quando a empresa tem mais de uma (com uma só, o sufixo é ruído).
 */
export function salasParaSeletor(
  linhas: { id: string; name: string; unit_id: string | null }[],
  unidades: { id: string; name: string }[],
): SalaDaUnidade[] {
  const nome = new Map(unidades.map((u) => [u.id, u.name]));
  const variasUnidades = unidades.length > 1;
  return linhas.map((r) => ({
    id: r.id,
    name: r.name,
    unitId: r.unit_id,
    unitName: variasUnidades && r.unit_id ? nome.get(r.unit_id) ?? null : null,
  }));
}

/** A sala aparece no recorte do seletor de unidade do topo? Sem unidade, sempre. */
export function salaNoEscopo(unitId: string | null | undefined, escopo: string[] | null): boolean {
  return !escopo || !unitId || escopo.includes(unitId);
}
