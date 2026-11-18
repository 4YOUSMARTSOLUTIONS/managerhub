import { cache } from "react";
import { requireContext, dadosDeModulos } from "@/lib/tenant";
import { MODULE_BY_KEY, MODULES, type ModuleKey, type ModuleState } from "@/lib/modules";
import { FORA_DA_REGRA } from "@/lib/acesso-telas";

export type ModuleAccess = {
  /** Estado resolvido de cada módulo para o escopo de unidade atual. */
  state: Record<ModuleKey, ModuleState>;
  /** Módulos marcados como "em construção" (global, definido pelo super admin). */
  construction: Set<ModuleKey>;
  /** A pessoa tem acesso restrito por nível ou por exceção (Configurações > Colaboradores). */
  restrito: boolean;
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
    return { state, construction: new Set<ModuleKey>(), restrito: false };
  }

  const unitIds = unitScope.activeUnitId ? [unitScope.activeUnitId] : unitScope.allowedUnitIds;

  // Buscado pelo `requireContext` na mesma rodada das unidades (desempenho,
  // LUIZ 18/11/2026); aqui só se espera o resultado. `unit_modules` vem da
  // empresa inteira, e o recorte pelas unidades do escopo é este filtro (tenant
  // sem unidades: nada vendável liberado, não há operação sem unidade).
  const { linhas, emConstrucao: flags, telas: restricao, erroTelas: erroRestricao } = await dadosDeModulos(tenant.id);
  const doEscopo = new Set(unitIds);
  const rows = linhas.filter((r) => doEscopo.has(r.unit_id));

  const best: Partial<Record<ModuleKey, ModuleState>> = {};
  for (const r of rows) {
    const k = r.module_key as ModuleKey;
    if (!(k in MODULE_BY_KEY)) continue; // key órfã no banco: ignora
    const cur = best[k];
    if (!cur || RANK[r.state] > RANK[cur]) best[k] = r.state;
  }

  const state = {} as Record<ModuleKey, ModuleState>;
  for (const m of MODULES) state[m.key] = m.core ? "on" : (best[m.key] ?? "hidden");

  // Acesso por nível ou exceção da pessoa: só TIRA telas. O que a unidade não
  // contratou continua de fora mesmo estando na lista. Erro na leitura deixa
  // passar (o menu de sempre) em vez de esconder tudo de todos: a restrição é
  // de tela, e a RLS continua decidindo os dados.
  if (erroRestricao) console.error("[acesso] minhas_telas", erroRestricao.message);
  const liberadas = Array.isArray(restricao) ? new Set<string>(restricao) : null;
  if (liberadas) {
    for (const m of MODULES) {
      if (!FORA_DA_REGRA.has(m.key) && !liberadas.has(m.key)) state[m.key] = "hidden";
    }
  }

  const construction = new Set(
    (flags ?? []).map((k) => k as ModuleKey).filter((k) => k in MODULE_BY_KEY),
  );

  return { state, construction, restrito: liberadas !== null };
});
