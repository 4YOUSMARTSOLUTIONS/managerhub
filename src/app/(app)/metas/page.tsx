import { requireContext, getMembers } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui/PageHeader";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { IndividualGoalsFarol, type GoalRow, type GoalEntryLite } from "@/components/IndividualGoalsFarol";
import { AreaGoalsFarol, type AreaGoalRow, type AreaEntryLite } from "@/components/AreaGoalsFarol";
import { moduleGate } from "@/lib/module-gate";

export default async function GoalsPage() {
  const gate = await moduleGate("metas");
  if (gate) return gate;

  const { tenant, user, role, unitScope } = await requireContext();
  const isAdmin = role === "owner" || role === "admin";
  const supabase = await createClient();

  // subordinados diretos (gestor = quem tem colaboradores abaixo). admin enxerga todos.
  let reportIds: string[] = [];
  if (!isAdmin) {
    const { data: reports } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("tenant_id", tenant.id)
      .eq("manager_id", user.id);
    reportIds = (reports ?? []).map((r) => r.user_id);
  }
  // só gestores (com subordinados) ou admin cadastram metas
  const canCreateGoals = isAdmin || reportIds.length > 0;
  const canSeeMultiple = canCreateGoals; // vê metas de mais de um colaborador
  // colaboradores visíveis: admin/owner = todos (null); demais = ele + subordinados
  const allowedOwnerIds: string[] | null = isAdmin ? null : [user.id, ...reportIds];

  let goalsQuery = supabase
    .from("individual_goals")
    .select("id, name, description, unit, direction, partial_pct, owner_id, owner:profiles!owner_id(full_name)")
    .eq("tenant_id", tenant.id);
  if (allowedOwnerIds) goalsQuery = goalsQuery.in("owner_id", allowedOwnerIds);
  const { data: goals } = await goalsQuery.order("name");

  const goalIds = (goals ?? []).map((g) => g.id);
  const { data: entries } = goalIds.length
    ? await supabase
        .from("individual_goal_entries")
        .select("goal_id, period, target_value, actual_value, weight, note, partial_value, rv_value, approval_status, approved_at, reproval_note")
        .in("goal_id", goalIds)
    : { data: [] as { goal_id: string; period: string; target_value: number; actual_value: number | null; weight: number; note: string | null; partial_value: number | null; rv_value: number | null; approval_status: "aberta" | "aprovada" | "reprovada"; approved_at: string | null; reproval_note: string | null }[] };

  const entriesByGoal = new Map<string, GoalEntryLite[]>();
  for (const e of entries ?? []) {
    const arr = entriesByGoal.get(e.goal_id) ?? [];
    arr.push({ period: e.period, target: e.target_value, actual: e.actual_value, weight: e.weight, note: e.note, partial: e.partial_value, status: e.approval_status, approvedAt: e.approved_at, reprovalNote: e.reproval_note });
    entriesByGoal.set(e.goal_id, arr);
  }

  // RV configurada em Configurações (vigências por função/colaborador). Leitura via
  // service client (RLS da config é owner/admin) — escopo restrito aos owners visíveis.
  const ownerIds = [...new Set((goals ?? []).map((g) => g.owner_id))];
  const rvTimelines: { ownerId: string; from: string; value: number }[] = [];
  if (ownerIds.length) {
    const admin = createServiceClient();
    const [{ data: rvCfgs }, { data: ownerMems }] = await Promise.all([
      admin.from("individual_rv_config").select("scope, position_id, user_id, effective_from, value").eq("tenant_id", tenant.id),
      admin.from("memberships").select("user_id, position_id").eq("tenant_id", tenant.id).in("user_id", ownerIds),
    ]);
    const posByOwner = new Map((ownerMems ?? []).map((m) => [m.user_id, m.position_id]));
    const cfgs = rvCfgs ?? [];
    for (const ownerId of ownerIds) {
      const posId = posByOwner.get(ownerId) ?? null;
      const userCfgs = cfgs.filter((c) => c.scope === "user" && c.user_id === ownerId);
      const posCfgs = posId ? cfgs.filter((c) => c.scope === "position" && c.position_id === posId) : [];
      if (userCfgs.length === 0 && posCfgs.length === 0) continue;
      // resolve a linha do tempo: em cada breakpoint vale o override do colaborador
      // (última vigência <= ponto); sem override, vale o da função
      const latest = (list: typeof cfgs, at: string) => {
        let best: (typeof cfgs)[number] | null = null;
        for (const c of list) if (c.effective_from <= at && (!best || c.effective_from > best.effective_from)) best = c;
        return best;
      };
      const breakpoints = [...new Set([...userCfgs, ...posCfgs].map((c) => c.effective_from))].sort();
      for (const bp of breakpoints) {
        const u = latest(userCfgs, bp);
        const p = latest(posCfgs, bp);
        const value = u ? u.value : p ? p.value : 0;
        rvTimelines.push({ ownerId, from: bp, value });
      }
    }
  }

  // mapa dono → setor/subsetor + opções de filtro (só p/ quem vê múltiplos colaboradores)
  const deptByUser = new Map<string, { dept: string | null; sub: string | null }>();
  let departments: { id: string; name: string }[] = [];
  let subdepartments: { id: string; name: string; departmentId: string }[] = [];
  let members: { id: string; name: string }[] = [];
  if (canSeeMultiple) {
    let memQuery = supabase.from("memberships").select("user_id, department_id, subdepartment_id").eq("tenant_id", tenant.id);
    if (allowedOwnerIds) memQuery = memQuery.in("user_id", allowedOwnerIds); // gestor: só o time
    const [{ data: mems }, { data: deps }, { data: subs }, mem2] = await Promise.all([
      memQuery,
      supabase.from("departments").select("id, name").eq("tenant_id", tenant.id).order("name"),
      supabase.from("subdepartments").select("id, name, department_id").eq("tenant_id", tenant.id).order("name"),
      getMembers(tenant.id),
    ]);
    for (const m of mems ?? []) deptByUser.set(m.user_id, { dept: m.department_id, sub: m.subdepartment_id });

    let depList = deps ?? [];
    let subList = subs ?? [];
    let memberList = mem2
      .map((m) => ({ id: m.profile?.id ?? "", name: m.profile?.full_name ?? m.profile?.email ?? "—" }))
      .filter((m) => m.id);
    // gestor: restringe setores/subsetores/colaboradores ao seu time
    if (!isAdmin && allowedOwnerIds) {
      const allow = new Set(allowedOwnerIds);
      memberList = memberList.filter((m) => allow.has(m.id));
      const teamDepts = new Set([...deptByUser.values()].map((v) => v.dept).filter((x): x is string => !!x));
      const teamSubs = new Set([...deptByUser.values()].map((v) => v.sub).filter((x): x is string => !!x));
      depList = depList.filter((d) => teamDepts.has(d.id));
      subList = subList.filter((s) => teamSubs.has(s.id));
    }
    departments = depList.map((d) => ({ id: d.id, name: d.name }));
    subdepartments = subList.map((s) => ({ id: s.id, name: s.name, departmentId: s.department_id }));
    members = memberList.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  const goalRows: GoalRow[] = (goals ?? []).map((g) => {
    const ds = deptByUser.get(g.owner_id) ?? { dept: null, sub: null };
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      unit: g.unit,
      direction: g.direction,
      partialPct: g.partial_pct,
      ownerId: g.owner_id,
      ownerName: (g.owner as unknown as { full_name: string | null } | null)?.full_name ?? "—",
      deptId: ds.dept,
      subdeptId: ds.sub,
      entries: entriesByGoal.get(g.id) ?? [],
    };
  });

  // ----- Metas da área (visível ao tenant) -----
  const [{ data: areaGoals }, { data: deptsAll }, { data: subsAll }, { data: unitsAll }, membersAll] = await Promise.all([
    supabase
      .from("area_goals")
      .select("id, name, description, unit, kind, direction, consolidation, department_id, subdepartment_id, unit_id, parent_id, owner_id, dept:departments(name), sub:subdepartments(name), orgUnit:units(name), owner:profiles!area_goals_owner_id_fkey(full_name)")
      .eq("tenant_id", tenant.id)
      .order("sort")
      .order("name"),
    supabase.from("departments").select("id, name").eq("tenant_id", tenant.id).order("name"),
    supabase.from("subdepartments").select("id, name, department_id").eq("tenant_id", tenant.id).order("name"),
    supabase.from("units").select("id, name").eq("tenant_id", tenant.id).order("name"),
    getMembers(tenant.id),
  ]);

  const areaIds = (areaGoals ?? []).map((g) => g.id);
  const { data: areaEntries } = areaIds.length
    ? await supabase
        .from("area_goal_entries")
        .select("area_goal_id, unit_id, period, target_value, actual_value, numerator_value, denominator_value")
        .in("area_goal_id", areaIds)
    : { data: [] as { area_goal_id: string; unit_id: string | null; period: string; target_value: number | null; actual_value: number | null; numerator_value: number | null; denominator_value: number | null }[] };

  const areaEntriesByGoal = new Map<string, AreaEntryLite[]>();
  for (const e of areaEntries ?? []) {
    const arr = areaEntriesByGoal.get(e.area_goal_id) ?? [];
    arr.push({ unitId: e.unit_id, period: e.period, target: e.target_value, actual: e.actual_value, numerator: e.numerator_value, denominator: e.denominator_value });
    areaEntriesByGoal.set(e.area_goal_id, arr);
  }

  const areaRows: AreaGoalRow[] = (areaGoals ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    unit: g.unit,
    kind: g.kind,
    direction: g.direction,
    consolidation: g.consolidation,
    departmentId: g.department_id,
    departmentName: (g.dept as unknown as { name: string } | null)?.name ?? null,
    subdepartmentId: g.subdepartment_id,
    subdepartmentName: (g.sub as unknown as { name: string } | null)?.name ?? null,
    unitId: g.unit_id,
    unitName: (g.orgUnit as unknown as { name: string } | null)?.name ?? null,
    parentId: g.parent_id,
    ownerId: g.owner_id,
    ownerName: (g.owner as unknown as { full_name: string | null } | null)?.full_name ?? null,
    entries: areaEntriesByGoal.get(g.id) ?? [],
  }));

  const areaDepartments = (deptsAll ?? []).map((d) => ({ id: d.id, name: d.name }));
  const areaSubdepartments = (subsAll ?? []).map((s) => ({ id: s.id, name: s.name, departmentId: s.department_id }));
  const areaUnits = (unitsAll ?? []).map((u) => ({ id: u.id, name: u.name }));
  const areaMembers = membersAll
    .map((m) => ({ id: m.profile?.id ?? "", name: m.profile?.full_name ?? m.profile?.email ?? "—" }))
    .filter((m) => m.id)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const tabs: Tab[] = [
    {
      id: "individual",
      label: "Metas individuais",
      content: (
        <IndividualGoalsFarol
          goals={goalRows}
          canManageOthers={canSeeMultiple}
          canCreateGoals={canCreateGoals}
          isAdmin={isAdmin}
          reportIds={reportIds}
          currentUserId={user.id}
          members={members}
          departments={departments}
          subdepartments={subdepartments}
          rvTimelines={rvTimelines}
        />
      ),
    },
    {
      id: "area",
      label: "Metas da área",
      content: (
        <AreaGoalsFarol
          goals={areaRows}
          departments={areaDepartments}
          subdepartments={areaSubdepartments}
          units={unitScope.units}
          members={areaMembers}
          isAdmin={isAdmin}
          currentUserId={user.id}
          scopedUnitId={unitScope.activeUnitId}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Metas" subtitle="Acompanhe o farol de metas individuais e da área." />
      <Tabs tabs={tabs} />
    </div>
  );
}
