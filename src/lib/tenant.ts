import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser, getIsSuperAdmin } from "@/lib/auth-cache";
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
/** Modo de visualização do super admin: "all" = vê tudo; senão = como a empresa. */
export const ADMIN_VIEW_COOKIE = "mh_admin_view";

export type CompanyOpt = { id: string; name: string };
/** Escopo de empresa — só para super admin (owner de plataforma). */
export type CompanyScope = { companies: CompanyOpt[]; activeTenantId: string; viewAll: boolean };

export type ActiveContext = {
  user: { id: string; email: string | undefined };
  tenant: Tables<"tenants">;
  role: Enums<"member_role">;
  unitScope: UnitScope;
  isSuperAdmin: boolean;
  /** presente só p/ super admin: lista de empresas + a selecionada no topo */
  companyScope: CompanyScope | null;
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
 *
 * `cache()`: layout, page e o gate de módulos chamam isto no mesmo request;
 * sem o cache seriam 3 rodadas das mesmas 3 queries.
 */
export const requireContext = cache(async function requireContext(): Promise<ActiveContext> {
  const supabase = await createClient();
  // identidade e papel vêm da camada compartilhada: o layout já resolveu ambos neste
  // mesmo request, então aqui não custa nova ida à rede
  const [user, isSuperAdmin] = await Promise.all([getAuthUser(), getIsSuperAdmin()]);

  if (!user) redirect("/login");

  let tenant: Tables<"tenants">;
  let role: Enums<"member_role">;
  let isAdmin: boolean;
  let membershipId: string | null = null;
  let companyScope: CompanyScope | null = null;

  if (isSuperAdmin) {
    // Owner de plataforma: opera na empresa selecionada no seletor do topo.
    const { data: activeId } = await supabase.rpc("my_active_tenant");
    if (!activeId) redirect("/admin"); // nenhuma empresa no sistema ainda
    const { data: t } = await supabase.from("tenants").select("*").eq("id", activeId).maybeSingle();
    if (!t) redirect("/admin");
    tenant = t as Tables<"tenants">;
    role = "owner";
    isAdmin = true;
    const { data: companies } = await supabase.from("tenants").select("id, name").eq("status", "active").order("name");
    const viewAll = (await cookies()).get(ADMIN_VIEW_COOKIE)?.value === "all";
    companyScope = { companies: companies ?? [], activeTenantId: tenant.id, viewAll };
  } else {
    const { data: memberships } = await supabase
      .from("memberships")
      .select("id, role, tenant_id, is_active, tenants(*)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1);
    const membership = memberships?.[0];
    if (!membership || !membership.tenants) redirect("/onboarding");
    if (membership.is_active === false) redirect("/suspenso");
    const t = membership.tenants as Tables<"tenants">;
    if (t.status !== "active") redirect("/suspenso");
    tenant = t;
    role = membership.role;
    isAdmin = role === "owner" || role === "admin";
    membershipId = membership.id;
  }

  // ----- escopo de unidade (dentro da empresa ativa) -----
  const { data: unitRows } = await supabase.from("units").select("id, name").eq("tenant_id", tenant.id).order("name");
  const allUnits: UnitOpt[] = unitRows ?? [];

  let allowed: UnitOpt[] = allUnits;
  if (!isAdmin && membershipId) {
    const { data: mu } = await supabase.from("membership_units").select("unit_id").eq("membership_id", membershipId);
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
    role,
    unitScope: { units: allowed, allowedUnitIds, unrestricted, activeUnitId, locked: allowed.length === 1 },
    isSuperAdmin,
    companyScope,
  };
});

/** `cache()`: /metas chamava isto duas vezes no mesmo request, e outras 7 telas uma vez. */
export const getMembers = cache(async function getMembers(tenantId: string) {
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
});
