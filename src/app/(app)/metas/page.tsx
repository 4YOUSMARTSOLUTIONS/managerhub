import { requireContext, getMembers } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { IndividualGoalsFarol, type GoalRow, type GoalEntryLite } from "@/components/IndividualGoalsFarol";
import { AreaGoalsFarol, type AreaGoalRow, type AreaEntryLite } from "@/components/AreaGoalsFarol";

export default async function GoalsPage() {
  const { tenant, user, role, unitScope } = await requireContext();
  const isAdmin = role === "owner" || role === "admin";
  const supabase = await createClient();

  let goalsQuery = supabase
    .from("individual_goals")
    .select("id, name, description, unit, direction, owner_id, owner:profiles!owner_id(full_name)")
    .eq("tenant_id", tenant.id);
  if (!isAdmin) goalsQuery = goalsQuery.eq("owner_id", user.id);
  const { data: goals } = await goalsQuery.order("name");

  const goalIds = (goals ?? []).map((g) => g.id);
  const { data: entries } = goalIds.length
    ? await supabase
        .from("individual_goal_entries")
        .select("goal_id, period, target_value, actual_value, weight, note")
        .in("goal_id", goalIds)
    : { data: [] as { goal_id: string; period: string; target_value: number; actual_value: number | null; weight: number; note: string | null }[] };

  const entriesByGoal = new Map<string, GoalEntryLite[]>();
  for (const e of entries ?? []) {
    const arr = entriesByGoal.get(e.goal_id) ?? [];
    arr.push({ period: e.period, target: e.target_value, actual: e.actual_value, weight: e.weight, note: e.note });
    entriesByGoal.set(e.goal_id, arr);
  }

  // mapa dono → setor/subsetor (para os filtros do admin)
  const deptByUser = new Map<string, { dept: string | null; sub: string | null }>();
  let departments: { id: string; name: string }[] = [];
  let subdepartments: { id: string; name: string; departmentId: string }[] = [];
  let members: { id: string; name: string }[] = [];
  if (isAdmin) {
    const [{ data: mems }, { data: deps }, { data: subs }, mem2] = await Promise.all([
      supabase.from("memberships").select("user_id, department_id, subdepartment_id").eq("tenant_id", tenant.id),
      supabase.from("departments").select("id, name").eq("tenant_id", tenant.id).order("name"),
      supabase.from("subdepartments").select("id, name, department_id").eq("tenant_id", tenant.id).order("name"),
      getMembers(tenant.id),
    ]);
    for (const m of mems ?? []) deptByUser.set(m.user_id, { dept: m.department_id, sub: m.subdepartment_id });
    departments = (deps ?? []).map((d) => ({ id: d.id, name: d.name }));
    subdepartments = (subs ?? []).map((s) => ({ id: s.id, name: s.name, departmentId: s.department_id }));
    members = mem2
      .map((m) => ({ id: m.profile?.id ?? "", name: m.profile?.full_name ?? m.profile?.email ?? "—" }))
      .filter((m) => m.id)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  const goalRows: GoalRow[] = (goals ?? []).map((g) => {
    const ds = deptByUser.get(g.owner_id) ?? { dept: null, sub: null };
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      unit: g.unit,
      direction: g.direction,
      ownerId: g.owner_id,
      ownerName: (g.owner as unknown as { full_name: string | null } | null)?.full_name ?? "—",
      deptId: ds.dept,
      subdeptId: ds.sub,
      entries: entriesByGoal.get(g.id) ?? [],
    };
  });

  // ----- Metas da área (visível ao tenant) -----
  const [{ data: areaGoals }, { data: deptsAll }, { data: unitsAll }, membersAll] = await Promise.all([
    supabase
      .from("area_goals")
      .select("id, name, unit, kind, direction, consolidation, department_id, owner_id, dept:departments(name), owner:profiles!area_goals_owner_id_fkey(full_name)")
      .eq("tenant_id", tenant.id)
      .order("sort")
      .order("name"),
    supabase.from("departments").select("id, name").eq("tenant_id", tenant.id).order("name"),
    supabase.from("units").select("id, name").eq("tenant_id", tenant.id).order("name"),
    getMembers(tenant.id),
  ]);

  const areaIds = (areaGoals ?? []).map((g) => g.id);
  const { data: areaEntries } = areaIds.length
    ? await supabase
        .from("area_goal_entries")
        .select("area_goal_id, unit_id, period, target_value, actual_value")
        .in("area_goal_id", areaIds)
    : { data: [] as { area_goal_id: string; unit_id: string | null; period: string; target_value: number | null; actual_value: number | null }[] };

  const areaEntriesByGoal = new Map<string, AreaEntryLite[]>();
  for (const e of areaEntries ?? []) {
    const arr = areaEntriesByGoal.get(e.area_goal_id) ?? [];
    arr.push({ unitId: e.unit_id, period: e.period, target: e.target_value, actual: e.actual_value });
    areaEntriesByGoal.set(e.area_goal_id, arr);
  }

  const areaRows: AreaGoalRow[] = (areaGoals ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    unit: g.unit,
    kind: g.kind,
    direction: g.direction,
    consolidation: g.consolidation,
    departmentId: g.department_id,
    departmentName: (g.dept as unknown as { name: string } | null)?.name ?? null,
    ownerId: g.owner_id,
    ownerName: (g.owner as unknown as { full_name: string | null } | null)?.full_name ?? null,
    entries: areaEntriesByGoal.get(g.id) ?? [],
  }));

  const areaDepartments = (deptsAll ?? []).map((d) => ({ id: d.id, name: d.name }));
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
          isAdmin={isAdmin}
          currentUserId={user.id}
          members={members}
          departments={departments}
          subdepartments={subdepartments}
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
