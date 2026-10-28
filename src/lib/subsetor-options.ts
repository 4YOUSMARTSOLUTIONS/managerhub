import type { MultiOption } from "@/components/ui/MultiSelect";

/**
 * Opções de subsetor agrupadas sob o nome do setor.
 *
 * Nome de subsetor se repete entre setores ("1º turno", "Frota", "Logística"),
 * e numa lista solta as duas linhas ficam idênticas: não há como saber qual
 * marcar. Com o setor como cabeçalho, cada uma fica no seu lugar.
 *
 * A ordem é setor e, dentro dele, subsetor, ambos em ordem alfabética: o
 * componente agrupa na ordem em que os grupos aparecem, então quem ordena é aqui.
 */
export function opcoesDeSubsetor(
  subs: { id: string; name: string; departmentId: string }[],
  setores: { id: string; name: string }[],
): MultiOption[] {
  const nomeDoSetor = new Map(setores.map((d) => [d.id, d.name]));
  return subs
    .map((s) => ({ value: s.id, label: s.name, group: nomeDoSetor.get(s.departmentId) ?? "Sem setor" }))
    .sort((a, b) => a.group.localeCompare(b.group, "pt-BR") || a.label.localeCompare(b.label, "pt-BR"));
}
