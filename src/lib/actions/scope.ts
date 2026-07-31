"use server";

import { cookies } from "next/headers";
import { requireContext, UNIT_COOKIE, ADMIN_VIEW_COOKIE } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";

/** Super admin alterna entre "ver como a empresa" e "ver tudo". */
export async function setAdminView(viewAll: boolean): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_VIEW_COOKIE, viewAll ? "all" : "company", {
    path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax",
  });
}

/** Super admin troca a empresa que está visualizando (seletor de empresas do topo). */
export async function setActiveCompany(tenantId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_active_tenant", { p_tenant: tenantId });
  if (error) return;
  // as unidades mudam por empresa: reseta o filtro de unidade para "Todas"
  const cookieStore = await cookies();
  cookieStore.set(UNIT_COOKIE, "all", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}

/** Define o escopo de unidade global (cookie). value = unitId ou "all". */
export async function setUnitScope(value: string): Promise<void> {
  const { unitScope } = await requireContext();
  if (unitScope.locked) return; // acesso a 1 unidade só — não alterna

  const ok = value === "all" || unitScope.allowedUnitIds.includes(value);
  if (!ok) return;

  const cookieStore = await cookies();
  cookieStore.set(UNIT_COOKIE, value, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
