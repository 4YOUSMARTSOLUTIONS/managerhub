import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
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
  user: { id: string; email: string | null | undefined };
  tenant: Tables<"tenants">;
  role: Enums<"member_role">;
  /** RH é atribuição (`memberships.is_hr`), não perfil: combina com qualquer `role` */
  isHr: boolean;
  /** departamento pessoal: proprietário, administrador ou quem tem a marca RH */
  isDp: boolean;
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
  // O usuário vem do token (getClaims, local), sem ida à rede.
  const user = await getAuthUser();
  if (!user) redirect("/login");

  // 1ª rodada (desempenho, LUIZ 18/11/2026): as três perguntas que antes iam em
  // fila saem JUNTAS. É super admin? Qual o vínculo? Qual a empresa ativa do
  // seletor? A empresa ativa só serve ao super admin, mas é uma consulta leve,
  // e esperar o "é super admin?" para fazê-la custava uma rodada inteira.
  const [isSuperAdmin, { data: memberships }, { data: activeTenantId }] = await Promise.all([
    getIsSuperAdmin(),
    supabase
      .from("memberships")
      .select("id, role, tenant_id, is_active, is_hr, tenants(*)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1),
    supabase.rpc("my_active_tenant"),
  ]);

  let tenantId: string;
  let tenantDoVinculo: Tables<"tenants"> | null = null;
  let role: Enums<"member_role">;
  let isHr = false;
  let isAdmin: boolean;
  let membershipId: string | null = null;

  if (isSuperAdmin) {
    // Owner de plataforma: opera na empresa selecionada no seletor do topo.
    const activeId = activeTenantId as string | null;
    if (!activeId) redirect("/admin"); // nenhuma empresa no sistema ainda
    tenantId = activeId;
    role = "owner";
    isAdmin = true;
  } else {
    const membership = memberships?.[0];
    if (!membership || !membership.tenants) redirect("/onboarding");
    if (membership.is_active === false) redirect("/suspenso");
    const t = membership.tenants as Tables<"tenants">;
    if (t.status !== "active") redirect("/suspenso");
    tenantDoVinculo = t;
    tenantId = t.id;
    role = membership.role;
    isHr = membership.is_hr;
    isAdmin = role === "owner" || role === "admin";
    membershipId = membership.id;
  }

  // 2ª rodada: tudo o que depende só do id da empresa (e do vínculo) sai junto.
  // Os módulos (unidades contratadas, telas liberadas, em construção) começam
  // aqui e o `getModuleAccess` só aproveita o resultado, sem rodada própria.
  void dadosDeModulos(tenantId).catch(() => undefined);
  const [{ data: unitRows }, { data: mu }, superAdmin, cookieStore] = await Promise.all([
    supabase.from("units").select("id, name").eq("tenant_id", tenantId).order("name"),
    // admin enxerga todas as unidades: nem chega a perguntar
    !isAdmin && membershipId
      ? supabase.from("membership_units").select("unit_id").eq("membership_id", membershipId)
      : Promise.resolve({ data: null as { unit_id: string }[] | null }),
    // o super admin precisa da linha da empresa e da lista do seletor
    isSuperAdmin
      ? Promise.all([
          supabase.from("tenants").select("*").eq("id", tenantId).maybeSingle(),
          supabase.from("tenants").select("id, name").eq("status", "active").order("name"),
        ])
      : Promise.resolve(null),
    cookies(),
  ]);

  let tenant: Tables<"tenants">;
  let companyScope: CompanyScope | null = null;
  if (superAdmin) {
    const [{ data: t }, { data: companies }] = superAdmin;
    if (!t) redirect("/admin");
    tenant = t as Tables<"tenants">;
    const viewAll = cookieStore.get(ADMIN_VIEW_COOKIE)?.value === "all";
    companyScope = { companies: companies ?? [], activeTenantId: tenant.id, viewAll };
  } else {
    tenant = tenantDoVinculo as Tables<"tenants">;
  }

  // ----- escopo de unidade (dentro da empresa ativa) -----
  const allUnits: UnitOpt[] = unitRows ?? [];

  let allowed: UnitOpt[] = allUnits;
  if (mu) {
    const muIds = new Set(mu.map((x) => x.unit_id));
    if (muIds.size > 0) allowed = allUnits.filter((u) => muIds.has(u.id)); // restrito; vazio = não restrito
  }
  const allowedUnitIds = allowed.map((u) => u.id);
  const unrestricted = allowedUnitIds.length === allUnits.length;

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
    isHr,
    isDp: isAdmin || isHr,
    unitScope: { units: allowed, allowedUnitIds, unrestricted, activeUnitId, locked: allowed.length === 1 },
    isSuperAdmin,
    companyScope,
  };
});

/**
 * O que o controle de módulos precisa, buscado UMA vez por request e o quanto
 * antes: o `requireContext` dispara assim que sabe a empresa, e o
 * `getModuleAccess` só espera o resultado (antes era uma rodada a mais, depois
 * das unidades, em toda navegação).
 *
 * `unit_modules` vem da empresa INTEIRA e o recorte pelas unidades do escopo é
 * feito no `getModuleAccess`: são poucas linhas (unidades × módulos), e assim a
 * consulta não precisa esperar as unidades.
 */
export const dadosDeModulos = cache(async function dadosDeModulos(tenantId: string) {
  const supabase = await createClient();
  const [{ data: linhas }, { data: emConstrucao }, { data: telas, error: erroTelas }] = await Promise.all([
    supabase.from("unit_modules").select("unit_id, module_key, state").eq("tenant_id", tenantId),
    // O catálogo de módulos da plataforma é informação comercial nossa: a RPC
    // devolve só a lista de chaves em obra, que a interface já mostra no selo.
    supabase.rpc("modulos_em_construcao"),
    // telas liberadas para esta pessoa (null = sem restrição); ver acesso-telas.ts
    supabase.rpc("minhas_telas", { p_tenant: tenantId }),
  ]);
  return { linhas: linhas ?? [], emConstrucao: emConstrucao ?? [], telas, erroTelas };
});

/** `cache()`: /metas chamava isto duas vezes no mesmo request, e outras 7 telas uma vez. */
export const getMembers = cache(async function getMembers(tenantId: string) {
  const supabase = await createClient();
  // paginado: os ativos ainda são poucos, mas esta é a lista de pessoas de oito
  // telas, e o corte em 1000 do PostgREST não avisa quando chega
  const { data } = await fetchAll(() => supabase
    .from("memberships")
    .select("role, user_id, employee_code, profiles!memberships_user_id_fkey(id, full_name, email)")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("id"));
  return (data ?? []).map((m) => ({
    role: m.role,
    profile: m.profiles as Tables<"profiles"> | null,
    /** matrícula: a busca de pessoa acha por ela (ex.: a blitz da portaria) */
    code: m.employee_code as string | null,
  }));
});
