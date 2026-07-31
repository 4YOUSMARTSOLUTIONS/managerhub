"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SELLABLE_KEYS, type ModuleKey, type ModuleState } from "@/lib/modules";
import type { ActionState } from "./types";

const STATES: ModuleState[] = ["on", "locked", "hidden"];

/** Só aceita keys do registry: evita gravar lixo em `unit_modules.module_key`. */
function parseModules(raw: FormDataEntryValue | null): ModuleKey[] {
  const keys = String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return keys.filter((k): k is ModuleKey => (SELLABLE_KEYS as string[]).includes(k));
}

function parseState(raw: FormDataEntryValue | null): ModuleState | null {
  const s = String(raw ?? "").trim();
  return (STATES as string[]).includes(s) ? (s as ModuleState) : null;
}

/**
 * Define o estado de um ou mais módulos numa unidade.
 * A autorização é do banco: as RPCs `platform_*` exigem `is_super_admin()`.
 */
export async function setUnitModules(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const unitId = String(formData.get("unit_id") ?? "").trim();
    const modules = parseModules(formData.get("modules"));
    const state = parseState(formData.get("state"));
    if (!unitId) return { error: "Unidade inválida." };
    if (!modules.length) return { error: "Nenhum módulo válido informado." };
    if (!state) return { error: "Estado inválido." };

    const supabase = await createClient();
    const { error } = await supabase.rpc("platform_set_unit_modules", {
      p_unit: unitId,
      p_modules: modules,
      p_state: state,
    });
    if (error) return { error: error.message };

    revalidatePath("/admin/modulos");
    revalidatePath("/", "layout"); // o menu depende disso
    return { ok: true, message: "Módulos atualizados." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Mesmo que acima, porém em todas as unidades da empresa (a venda é por empresa). */
export async function setTenantModules(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const tenantId = String(formData.get("tenant_id") ?? "").trim();
    const modules = parseModules(formData.get("modules"));
    const state = parseState(formData.get("state"));
    if (!tenantId) return { error: "Empresa inválida." };
    if (!modules.length) return { error: "Nenhum módulo válido informado." };
    if (!state) return { error: "Estado inválido." };

    const supabase = await createClient();
    const { error } = await supabase.rpc("platform_set_tenant_modules", {
      p_tenant: tenantId,
      p_modules: modules,
      p_state: state,
    });
    if (error) return { error: error.message };

    revalidatePath("/admin/modulos");
    revalidatePath("/", "layout");
    return { ok: true, message: "Módulos atualizados em todas as unidades." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Marca/desmarca "Em construção" (global, vale para todas as empresas). */
export async function setModuleConstruction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const modules = parseModules(formData.get("modules"));
    if (!modules.length) return { error: "Módulo inválido." };
    const under = String(formData.get("under") ?? "") === "true";

    const supabase = await createClient();
    const { error } = await supabase.rpc("platform_set_module_construction", {
      p_module: modules[0],
      p_under: under,
    });
    if (error) return { error: error.message };

    revalidatePath("/admin/construcao");
    revalidatePath("/", "layout");
    return { ok: true, message: under ? "Marcado como em construção." : "Construção removida." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
