import { redirect } from "next/navigation";
import { getModuleAccess } from "@/lib/module-access";
import { MODULE_BY_KEY, modulesInGroup, type GroupKey, type ModuleKey } from "@/lib/modules";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { ModuleLocked } from "@/components/ModuleLocked";

/**
 * Guarda de módulo. Devolve o que renderizar NO LUGAR do conteúdo, ou null se liberado.
 *
 * DEVE ser a primeira linha da page, ANTES de qualquer query: é o que garante que o
 * conteúdo de um módulo não contratado nunca chega a ser carregado.
 *
 *   const gate = await moduleGate("checklists");
 *   if (gate) return gate;
 *
 * Precedência: hidden > locked > em construção. "locked" ganha de "em construção"
 * de propósito: para quem não contratou, a tela de venda vale mais que um "em breve".
 */
/**
 * Índice de um grupo do menu: manda para o primeiro submódulo não escondido.
 * O destino tem o próprio `moduleGate`, então "locked" continua caindo na vitrine.
 */
export async function redirectToFirstVisible(group: GroupKey): Promise<never> {
  const { state } = await getModuleAccess();
  const first = modulesInGroup(group).find((m) => state[m.key] !== "hidden");
  redirect(first?.href ?? "/dashboard");
}

export async function moduleGate(key: ModuleKey): Promise<React.ReactNode | null> {
  const mod = MODULE_BY_KEY[key];
  if (process.env.NODE_ENV !== "production" && mod.core) {
    throw new Error(`moduleGate("${key}"): módulo base não deve ter gate (risco de loop de redirect).`);
  }

  const { state, construction } = await getModuleAccess();
  const s = state[key];

  // não contratado e sem vitrine: não revela que existe
  if (s === "hidden") redirect("/dashboard");

  if (s === "locked") {
    const { unitScope } = await requireContext();
    return (
      <div>
        <PageHeader title={mod.label} />
        <ModuleLocked
          moduleKey={key}
          moduleLabel={mod.label}
          unitIds={unitScope.activeUnitId ? [unitScope.activeUnitId] : unitScope.allowedUnitIds}
        />
      </div>
    );
  }

  if (construction.has(key)) {
    return (
      <div>
        <PageHeader title={mod.label} />
        <ComingSoon />
      </div>
    );
  }

  return null;
}
