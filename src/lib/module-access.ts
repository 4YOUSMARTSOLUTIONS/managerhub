import { cache } from "react";
import { requireContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { MODULE_BY_KEY, MODULES, type ModuleKey, type ModuleState } from "@/lib/modules";

export type ModuleAccess = {
  /** Estado resolvido de cada módulo para o escopo de unidade atual. */
  state: Record<ModuleKey, ModuleState>;
  /** Módulos marcados como "em construção" (global, definido pelo super admin). */
  construction: Set<ModuleKey>;
};

/** "melhor" estado vence na união entre unidades. */
const RANK: Record<ModuleState, number> = { hidden: 0, locked: 1, on: 2 };

/**
 * Resolve o acesso a módulos para a unidade ativa (ou a UNIÃO das permitidas
 * quando o escopo é "Todas as unidades"). Ausência de linha = bloqueado.
 */
export const getModuleAccess = cache(async function getModuleAccess(): Promise<ModuleAccess> {
  const { tenant, unitScope, isSuperAdmin, companyScope } = await requireContext();

  // Owner de plataforma no modo "Ver tudo": menu completo, sem gate.
  // No modo "Ver como a empresa" (padrão) cai no fluxo normal abaixo, respeitando
  // os módulos ocultos/vitrine que a empresa realmente tem.
  if (isSuperAdmin && companyScope?.viewAll) {
    const state = {} as Record<ModuleKey, ModuleState>;
    for (const m of MODULES) state[m.key] = "on";
    return { state, construction: new Set<ModuleKey>() };
  }

  const supabase = await createClient();

  const unitIds = unitScope.activeUnitId ? [unitScope.activeUnitId] : unitScope.allowedUnitIds;

  // tenant sem unidades: nada vendável liberado (não há operação sem unidade)
  const [{ data: rows }, { data: flags }] = await Promise.all([
    unitIds.length
      ? supabase.from("unit_modules").select("module_key, state").eq("tenant_id", tenant.id).in("unit_id", unitIds)
      : Promise.resolve({ data: [] as { module_key: string; state: ModuleState }[] }),
    // O catálogo de módulos da plataforma é informação comercial nossa, não do
    // cliente: a tabela só é legível pelo owner de plataforma. Esta RPC devolve
    // apenas a lista de chaves em obra, que é o que a interface já mostra ao
    // usuário no selo "Em construção".
    supabase.rpc("modulos_em_construcao"),
  ]);

  const best: Partial<Record<ModuleKey, ModuleState>> = {};
  for (const r of rows ?? []) {
    const k = r.module_key as ModuleKey;
    if (!(k in MODULE_BY_KEY)) continue; // key órfã no banco: ignora
    const cur = best[k];
    if (!cur || RANK[r.state] > RANK[cur]) best[k] = r.state;
  }

  const state = {} as Record<ModuleKey, ModuleState>;
  for (const m of MODULES) state[m.key] = m.core ? "on" : (best[m.key] ?? "hidden");

  const construction = new Set(
    (flags ?? []).map((k) => k as ModuleKey).filter((k) => k in MODULE_BY_KEY),
  );

  return { state, construction };
});
