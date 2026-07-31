import { requireContext, getMembers } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { PnrFarol, type PnrCategory, type PnrKpiRow, type PnrEntryLite } from "@/components/PnrFarol";
import { moduleGate } from "@/lib/module-gate";

export default async function PnrPage() {
  const gate = await moduleGate("pnr");
  if (gate) return gate;

  const { tenant, user, role } = await requireContext();
  const isAdmin = role === "owner" || role === "admin";
  const supabase = await createClient();

  const [{ data: cats }, { data: kpis }, membersAll] = await Promise.all([
    supabase.from("pnr_categories").select("id, name, sort, max_points").eq("tenant_id", tenant.id).order("sort").order("name"),
    supabase
      .from("pnr_kpis")
      .select("id, category_id, sort, name, description, owner_id, unit, direction, consolidation, max_points, target, partial_high, partial_low, points_high, points_low, owner:profiles!pnr_kpis_owner_id_fkey(full_name)")
      .eq("tenant_id", tenant.id)
      .order("sort")
      .order("name"),
    getMembers(tenant.id),
  ]);

  const kpiIds = (kpis ?? []).map((k) => k.id);
  const { data: entries } = kpiIds.length
    ? await supabase
        .from("pnr_entries")
        .select("kpi_id, period, actual_value, numerator_value, denominator_value")
        .in("kpi_id", kpiIds)
    : { data: [] as { kpi_id: string; period: string; actual_value: number | null; numerator_value: number | null; denominator_value: number | null }[] };

  const entriesByKpi = new Map<string, PnrEntryLite[]>();
  for (const e of entries ?? []) {
    const arr = entriesByKpi.get(e.kpi_id) ?? [];
    arr.push({ period: e.period, actual: e.actual_value, numerator: e.numerator_value, denominator: e.denominator_value });
    entriesByKpi.set(e.kpi_id, arr);
  }

  const categories: PnrCategory[] = (cats ?? []).map((c) => ({ id: c.id, name: c.name, sort: c.sort, maxPoints: c.max_points }));
  const kpiRows: PnrKpiRow[] = (kpis ?? []).map((k) => ({
    id: k.id,
    categoryId: k.category_id,
    sort: k.sort,
    name: k.name,
    description: k.description,
    ownerId: k.owner_id,
    ownerName: (k.owner as unknown as { full_name: string | null } | null)?.full_name ?? null,
    unit: k.unit,
    direction: k.direction,
    consolidation: k.consolidation,
    maxPoints: k.max_points,
    target: k.target,
    partialHigh: k.partial_high,
    partialLow: k.partial_low,
    pointsHigh: k.points_high,
    pointsLow: k.points_low,
    entries: entriesByKpi.get(k.id) ?? [],
  }));

  const members = membersAll
    .map((m) => ({ id: m.profile?.id ?? "", name: m.profile?.full_name ?? m.profile?.email ?? "—" }))
    .filter((m) => m.id)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div>
      <PageHeader title="PNR" subtitle="Programa Nacional de Revendas" />
      <PnrFarol categories={categories} kpis={kpiRows} members={members} isAdmin={isAdmin} currentUserId={user.id} />
    </div>
  );
}
