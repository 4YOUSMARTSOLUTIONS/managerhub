import { requireContext, getMembers } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { SustainabilityFarol, type SustKpiRow, type SustEntryLite } from "@/components/SustainabilityFarol";
import { moduleGate } from "@/lib/module-gate";

export default async function SustentabilidadePage() {
  const gate = await moduleGate("sustentabilidade");
  if (gate) return gate;

  const { tenant, user, role } = await requireContext();
  const isAdmin = role === "owner" || role === "admin";
  const supabase = await createClient();

  const [{ data: kpis }, membersAll] = await Promise.all([
    supabase
      .from("sustainability_kpis")
      .select("id, sort, name, owner_id, unit, direction, consolidation, target, owner:profiles!sustainability_kpis_owner_id_fkey(full_name)")
      .eq("tenant_id", tenant.id)
      .order("sort")
      .order("name"),
    getMembers(tenant.id),
  ]);

  const kpiIds = (kpis ?? []).map((k) => k.id);
  const { data: entries } = kpiIds.length
    ? await supabase.from("sustainability_entries").select("kpi_id, period, actual_value, numerator_value, denominator_value").in("kpi_id", kpiIds)
    : { data: [] as { kpi_id: string; period: string; actual_value: number | null; numerator_value: number | null; denominator_value: number | null }[] };

  const byKpi = new Map<string, SustEntryLite[]>();
  for (const e of entries ?? []) {
    const arr = byKpi.get(e.kpi_id) ?? [];
    arr.push({ period: e.period, actual: e.actual_value, numerator: e.numerator_value, denominator: e.denominator_value });
    byKpi.set(e.kpi_id, arr);
  }

  const rows: SustKpiRow[] = (kpis ?? []).map((k) => ({
    id: k.id,
    sort: k.sort,
    name: k.name,
    ownerId: k.owner_id,
    ownerName: (k.owner as unknown as { full_name: string | null } | null)?.full_name ?? null,
    unit: k.unit,
    direction: k.direction,
    consolidation: k.consolidation,
    target: k.target,
    entries: byKpi.get(k.id) ?? [],
  }));

  const members = membersAll
    .map((m) => ({ id: m.profile?.id ?? "", name: m.profile?.full_name ?? m.profile?.email ?? "—" }))
    .filter((m) => m.id)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div>
      <PageHeader title="KPIs de Sustentabilidade" subtitle="Indicadores de sustentabilidade da logística." />
      <SustainabilityFarol kpis={rows} members={members} isAdmin={isAdmin} currentUserId={user.id} />
    </div>
  );
}
