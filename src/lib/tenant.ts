import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { Enums, Tables } from "@/types/database";

export type UnitOpt = { id: string; name: string };
export type UnitScope = {
  units: UnitOpt[]; // unidades que o usuário PODE ver (para o seletor)
  allowedUnitIds: string[];
  unrestricted: boolean; // true = enxerga todas as unidades do tenant
  activeUnitId: string | null; // null = "Todas"
  locked: boolean; // true = acesso a 1 unidade só (sem "Todas")
};

export const UNIT_COOKIE = "mh_unit";

export type ActiveContext = {
  user: { id: string; email: string | undefined };
  tenant: Tables<"tenants">;
  role: Enums<"member_role">;
  unitScope: UnitScope;
};

/** Lista de unit_ids a aplicar na query, ou null (sem filtro = todas). */
export function effectiveUnitFilter(scope: UnitScope): string[] | null {
  if (scope.activeUnitId) return [scope.activeUnitId];
  if (scope.unrestricted) return null;
  return scope.allowedUnitIds;
}

/**
 * Garante usuário autenticado + tenant ativo.
 * Redireciona para /login se não autenticado e /onboarding se sem empresa.
 * Usa a primeira membership como tenant ativo (MVP).
 */
export async function requireContext(): Promise<ActiveContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("memberships")
    .select("id, role, tenant_id, is_active, tenants(*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);

  const membership = memberships?.[0];
  if (!membership || !membership.tenants) redirect("/onboarding");

  if (membership.is_active === false) redirect("/suspenso");

  const tenant = membership.tenants as Tables<"tenants">;
  if (tenant.status !== "active") redirect("/suspenso");

  // ----- escopo de unidade -----
  const isAdmin = membership.role === "owner" || membership.role === "admin";
  const { data: unitRows } = await supabase.from("units").select("id, name").eq("tenant_id", tenant.id).order("name");
  const allUnits: UnitOpt[] = unitRows ?? [];

  let allowed: UnitOpt[] = allUnits;
  if (!isAdmin) {
    const { data: mu } = await supabase.from("membership_units").select("unit_id").eq("membership_id", membership.id);
    const muIds = new Set((mu ?? []).map((x) => x.unit_id));
    if (muIds.size > 0) allowed = allUnits.filter((u) => muIds.has(u.id)); // restrito; vazio = não restrito
  }
  const allowedUnitIds = allowed.map((u) => u.id);
  const unrestricted = allowedUnitIds.length === allUnits.length;

  const cookieStore = await cookies();
  const raw = cookieStore.get(UNIT_COOKIE)?.value ?? null;
  let activeUnitId: string | null = null;
  if (allowed.length === 1) {
    activeUnitId = allowed[0].id; // travado numa única unidade
  } else if (raw && raw !== "all" && allowedUnitIds.includes(raw)) {
    activeUnitId = raw;
  }

  return {
    user: { id: user.id, email: user.email },
    tenant,
    role: membership.role,
    unitScope: { units: allowed, allowedUnitIds, unrestricted, activeUnitId, locked: allowed.length === 1 },
  };
}

export async function getMembers(tenantId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("memberships")
    .select("role, user_id, profiles!memberships_user_id_fkey(id, full_name, email)")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  return (data ?? []).map((m) => ({
    role: m.role,
    profile: m.profiles as Tables<"profiles"> | null,
  }));
}
