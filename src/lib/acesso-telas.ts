/**
 * Acesso às telas por nível, com exceção por pessoa (LUIZ, 10/11/2026).
 *
 * Quem guarda e decide é o banco (`minhas_telas`, tabelas acesso_telas_*):
 * exceção da pessoa > regra do nível > sem restrição. Proprietário,
 * administrador e RH nunca são restringidos. Aqui ficam as peças que servidor e
 * tela compartilham: quais telas entram na regra, a ordem, o resumo e a tela
 * inicial de quem não vê o Dashboard.
 */
import {
  MODULE_BY_KEY, MODULE_GROUPS, NAV_ORDER, modulesInGroup,
  type ModuleDef, type ModuleKey, type ModuleState,
} from "@/lib/modules";

/** Fora da regra: são de proprietário/administrador, que nunca são restringidos. */
export const FORA_DA_REGRA = new Set<ModuleKey>(["admin", "auditoria"]);

/** As telas na ordem do menu (Dashboard primeiro, grupos no meio). */
export const ORDEM_DAS_TELAS: ModuleKey[] = NAV_ORDER.flatMap((n) =>
  n.type === "module" ? [n.key] : modulesInGroup(n.key).map((m) => m.key),
);

export type GrupoDeTelas = { grupo: string | null; telas: { key: ModuleKey; label: string }[] };

/**
 * O que aparece para escolher: as telas base e as contratadas em alguma
 * unidade. Tela não contratada não entra, porque liberá-la não teria efeito.
 */
export function opcoesDeTelas(contratadas: Set<string>): GrupoDeTelas[] {
  const entra = (m: ModuleDef) => !FORA_DA_REGRA.has(m.key) && (m.core || contratadas.has(m.key));
  const soltas: GrupoDeTelas = { grupo: null, telas: [] };
  const grupos: GrupoDeTelas[] = [];
  for (const n of NAV_ORDER) {
    if (n.type === "module") {
      const m = MODULE_BY_KEY[n.key];
      if (entra(m)) soltas.telas.push({ key: m.key, label: m.label });
    } else {
      const telas = modulesInGroup(n.key).filter(entra).map((m) => ({ key: m.key, label: m.label }));
      if (telas.length) grupos.push({ grupo: MODULE_GROUPS.find((g) => g.key === n.key)?.label ?? null, telas });
    }
  }
  return soltas.telas.length ? [soltas, ...grupos] : grupos;
}

/** Só chaves que existem e entram na regra, sem repetição. */
export function telasValidas(keys: string[]): ModuleKey[] {
  const ok = new Set(keys.filter((k): k is ModuleKey => k in MODULE_BY_KEY && !FORA_DA_REGRA.has(k as ModuleKey)));
  return ORDEM_DAS_TELAS.filter((k) => ok.has(k));
}

const juntar = (xs: string[]) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`;

/** "Férias", "Férias e Treinamentos", "Férias, Chat interno e mais 2". */
export function resumoDasTelas(keys: string[] | null): string {
  if (keys === null) return "Todas as telas contratadas";
  const nomes = ORDEM_DAS_TELAS.filter((k) => keys.includes(k)).map((k) => MODULE_BY_KEY[k].label);
  if (nomes.length === 0) return "Nenhuma tela";
  if (nomes.length <= 3) return juntar(nomes);
  return `${nomes.slice(0, 2).join(", ")} e mais ${nomes.length - 2}`;
}

/**
 * Para onde vai quem não vê o Dashboard: a primeira tela liberada na ordem do
 * menu, preferindo a que está em uso de verdade ("on") à vitrine ("locked").
 * `null` = nenhuma tela; a página inicial avisa em vez de redirecionar em ciclo.
 */
export function primeiraTela(
  state: Record<ModuleKey, ModuleState>,
  podeVer: (m: ModuleDef) => boolean,
): string | null {
  if (state.dashboard !== "hidden") return "/dashboard";
  const candidatas = ORDEM_DAS_TELAS.filter((k) => k !== "dashboard" && podeVer(MODULE_BY_KEY[k]));
  const destino = candidatas.find((k) => state[k] === "on") ?? candidatas.find((k) => state[k] === "locked");
  return destino ? MODULE_BY_KEY[destino].href : null;
}
