import { requireContext, getMembers } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { AreaGoalsFarol, type AreaGoalRow, type AreaEntryLite } from "@/components/AreaGoalsFarol";
import { moduleGate } from "@/lib/module-gate";

/**
 * Metas da área, em tela própria.
 *
 * Saiu de dentro de /metas, onde era a segunda aba. Como aba, ela herdava o
 * carregamento inteiro das metas individuais (RV, ausências, punições, retratos
 * de fechamento) só para ser desenhada, e quem só acompanha indicador de área
 * pagava por isso a cada abertura. Aqui a página lê o que ela usa e nada mais.
 *
 * A `key` do módulo é própria (`metas_area`), então a empresa pode contratar uma
 * sem a outra. A migração 20260910... copia o estado de `metas` para quem já
 * tinha, senão o item sumiria do menu de quem já usava.
 */
export default async function AreaGoalsPage() {
  const gate = await moduleGate("metas_area");
  if (gate) return gate;

  const { tenant, user, role, unitScope } = await requireContext();
  const isAdmin = role === "owner" || role === "admin";
  const supabase = await createClient();

  const [{ data: areaGoals }, { data: deps }, { data: subs }, todosMembros, { data: minhaLinha }] = await Promise.all([
    supabase
      .from("area_goals")
      .select("id, name, description, unit, kind, direction, consolidation, department_id, subdepartment_id, unit_id, parent_id, owner_id, created_by, dept:departments(name), sub:subdepartments(name), orgUnit:units(name), owner:profiles!area_goals_owner_id_fkey(full_name)")
      .eq("tenant_id", tenant.id)
      .order("sort")
      .order("name"),
    supabase.from("departments").select("id, name").eq("tenant_id", tenant.id).order("name"),
    supabase.from("subdepartments").select("id, name, department_id").eq("tenant_id", tenant.id).order("name"),
    getMembers(tenant.id),
    // só a própria linha: o que a tela precisa daqui é o setor/subsetor com que
    // ela abre, não a lista de ninguém
    supabase
      .from("memberships")
      .select("department_id, subdepartment_id")
      .eq("tenant_id", tenant.id)
      .eq("user_id", user.id)
      .maybeSingle(),
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
    createdById: g.created_by,
    ownerId: g.owner_id,
    ownerName: (g.owner as unknown as { full_name: string | null } | null)?.full_name ?? null,
    entries: areaEntriesByGoal.get(g.id) ?? [],
  }));

  // UNIDADES QUE A PESSOA ALCANÇA POR RESPONSABILIDADE, e só nesta tela.
  //
  // O Financeiro é centralizado na Matriz e responde por metas da Filial. O
  // seletor do topo não resolve: ele vale para o sistema inteiro, e alargar lá
  // daria acesso à Filial em chamados, ações e reuniões também.
  //
  // Então a autorização sai do próprio cadastro da meta: se a meta da Filial está
  // no seu nome, você alcança a Filial aqui. Nada para marcar em lugar nenhum:
  // cadastrou no nome da pessoa, ela passa a poder; tirou, ela deixa de poder. E
  // o alcance é só o que ela responde, não a Filial inteira.
  const unidadesExtras = (() => {
    const m = new Map<string, string>();
    for (const g of areaGoals ?? []) {
      if (g.owner_id !== user.id || !g.unit_id) continue;
      if (unitScope.allowedUnitIds.includes(g.unit_id)) continue;
      m.set(g.unit_id, (g.orgUnit as unknown as { name: string } | null)?.name ?? "Outra unidade");
    }
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  })();

  const members = todosMembros
    .map((m) => ({ id: m.profile?.id ?? "", name: m.profile?.full_name ?? m.profile?.email ?? "-" }))
    .filter((m) => m.id)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div>
      <PageHeader title="Metas da área" subtitle="Acompanhe o farol dos indicadores por setor e unidade." />
      <AreaGoalsFarol
        goals={areaRows}
        departments={(deps ?? []).map((d) => ({ id: d.id, name: d.name }))}
        subdepartments={(subs ?? []).map((s) => ({ id: s.id, name: s.name, departmentId: s.department_id }))}
        units={unitScope.units}
        members={members}
        isAdmin={isAdmin}
        // metas da ÁREA: quem lidera também CADASTRA (Gerencial e Gestor), e
        // edita ou exclui o que cadastrou. Mexer no indicador dos outros
        // continua sendo da administração, como diz a RLS.
        podeCriarIndicador={isAdmin || role === "manager" || role === "team_lead"}
        currentUserId={user.id}
        scopedUnitId={unitScope.activeUnitId}
        unidadesExtras={unidadesExtras}
        deptPadrao={minhaLinha?.department_id ?? ""}
        subPadrao={minhaLinha?.subdepartment_id ?? ""}
      />
    </div>
  );
}
