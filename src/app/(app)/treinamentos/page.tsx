import { requireContext, getMembers, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { moduleGate } from "@/lib/module-gate";
import {
  TrainingsManager,
  type TrainingRow,
  type MyEnrollmentRow,
  type EnrollmentRow,
  type Opt,
  type SubOpt,
} from "@/components/TrainingsManager";

export default async function TreinamentosPage() {
  const gate = await moduleGate("treinamentos");
  if (gate) return gate;

  const { tenant, user, role, unitScope } = await requireContext();
  const podeCadastrar = role === "owner" || role === "admin" || role === "hr";
  const supabase = await createClient();

  const unitIds = effectiveUnitFilter(unitScope);
  // Treinamento sem unidade vale para a empresa inteira e aparece em qualquer
  // recorte, mesmo critério de /acoes e /checklists.
  const unitOr = unitIds ? `unit_id.in.(${unitIds.join(",")}),unit_id.is.null` : null;

  let cursosQuery = supabase
    .from("trainings")
    .select(
      "id, name, description, code, workload_minutes, delivery, validade_meses, antecipacao_dias, prazo_dias, " +
      "unit_id, department_id, subdepartment_id, active, created_at, " +
      "unit:units(name), dept:departments(name), sub:subdepartments(name), " +
      "pilar:sdpo_pilares(name), owners:training_owners(user_id), rules:training_assignment_rules(kind, ref_id, mandatory)",
    )
    .eq("tenant_id", tenant.id)
    .is("deleted_at", null)
    .order("name");
  if (unitOr) cursosQuery = cursosQuery.or(unitOr);

  const [
    { data: cursos },
    { data: minhas },
    { data: todasMatriculas },
    membros,
    { data: deps },
    { data: subs },
    { data: cargos },
    { data: pilares },
  ] = await Promise.all([
    cursosQuery,
    // as minhas: a RLS já recorta, o filtro por user_id é só para não trazer a
    // equipe inteira de quem é gestor
    supabase
      .from("training_enrollments")
      .select("id, training_id, status, mandatory, due_at, completed_at, expires_at, score, session_id, cycle_no")
      .eq("tenant_id", tenant.id)
      .eq("user_id", user.id)
      .neq("status", "nao_aplicavel")
      .neq("status", "cancelado"),
    // o acompanhamento: quem não gere ninguém recebe só as próprias, por RLS
    supabase
      .from("training_enrollments")
      .select("id, training_id, user_id, status, mandatory, due_at, completed_at, expires_at, score, snap_department_id, applicable")
      .eq("tenant_id", tenant.id)
      .neq("status", "nao_aplicavel")
      .neq("status", "cancelado")
      .limit(5000),
    getMembers(tenant.id),
    supabase.from("departments").select("id, name").eq("tenant_id", tenant.id).eq("active", true).order("name"),
    supabase.from("subdepartments").select("id, name, department_id").eq("tenant_id", tenant.id).eq("active", true).order("name"),
    supabase.from("positions").select("id, name").eq("tenant_id", tenant.id).eq("active", true).order("name"),
    supabase.from("sdpo_pilares").select("id, name").eq("tenant_id", tenant.id).eq("active", true).order("name"),
  ]);

  const nomePorUsuario = new Map<string, string>();
  for (const m of membros) {
    if (m.profile?.id) nomePorUsuario.set(m.profile.id, m.profile.full_name ?? m.profile.email ?? "—");
  }

  const nome1 = (v: unknown) => (v as { name: string } | null)?.name ?? null;

  // O typegen não resolve embed de tabela cujas Relationships são declaradas
  // vazias (elas são mantidas à mão aqui). Mesmo padrão de /checklists: o
  // formato da linha é declarado uma vez e o cast acontece num ponto só.
  type CursoDb = {
    id: string; name: string; description: string | null; code: string | null;
    workload_minutes: number; delivery: TrainingRow["delivery"];
    validade_meses: number | null; antecipacao_dias: number; prazo_dias: number | null;
    unit_id: string | null; department_id: string | null; subdepartment_id: string | null;
    active: boolean; created_at: string;
    unit: unknown; dept: unknown; sub: unknown; pilar: unknown;
    owners: { user_id: string }[] | null;
    rules: { kind: string; ref_id: string; mandatory: boolean }[] | null;
  };

  const trainings: TrainingRow[] = ((cursos ?? []) as unknown as CursoDb[]).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    code: t.code,
    workloadMinutes: t.workload_minutes,
    delivery: t.delivery,
    validadeMeses: t.validade_meses,
    antecipacaoDias: t.antecipacao_dias,
    prazoDias: t.prazo_dias,
    unitName: nome1(t.unit),
    deptName: nome1(t.dept),
    subName: nome1(t.sub),
    pilarName: nome1(t.pilar),
    active: t.active,
    ownerNames: (t.owners ?? []).map((o) => nomePorUsuario.get(o.user_id) ?? "—"),
    ruleCount: (t.rules ?? []).length,
    mandatory: (t.rules ?? []).some((r) => r.mandatory),
  }));

  const cursoPorId = new Map(trainings.map((t) => [t.id, t]));

  const myEnrollments: MyEnrollmentRow[] = (minhas ?? [])
    .filter((e) => cursoPorId.has(e.training_id))
    .map((e) => ({
      id: e.id,
      trainingId: e.training_id,
      trainingName: cursoPorId.get(e.training_id)!.name,
      workloadMinutes: cursoPorId.get(e.training_id)!.workloadMinutes,
      delivery: cursoPorId.get(e.training_id)!.delivery,
      antecipacaoDias: cursoPorId.get(e.training_id)!.antecipacaoDias,
      status: e.status,
      mandatory: e.mandatory,
      dueAt: e.due_at,
      completedAt: e.completed_at,
      expiresAt: e.expires_at,
      score: e.score,
      cycleNo: e.cycle_no,
    }));

  const enrollments: EnrollmentRow[] = (todasMatriculas ?? [])
    .filter((e) => cursoPorId.has(e.training_id))
    .map((e) => ({
      id: e.id,
      trainingId: e.training_id,
      trainingName: cursoPorId.get(e.training_id)!.name,
      antecipacaoDias: cursoPorId.get(e.training_id)!.antecipacaoDias,
      userId: e.user_id,
      userName: nomePorUsuario.get(e.user_id) ?? "—",
      deptId: e.snap_department_id,
      status: e.status,
      mandatory: e.mandatory,
      dueAt: e.due_at,
      completedAt: e.completed_at,
      expiresAt: e.expires_at,
      score: e.score,
    }));

  const departments: Opt[] = (deps ?? []).map((d) => ({ id: d.id, name: d.name }));
  const subdepartments: SubOpt[] = (subs ?? []).map((s) => ({ id: s.id, name: s.name, departmentId: s.department_id }));
  const positions: Opt[] = (cargos ?? []).map((p) => ({ id: p.id, name: p.name }));
  const pilaresOpt: Opt[] = (pilares ?? []).map((p) => ({ id: p.id, name: p.name }));
  const people: Opt[] = membros
    .map((m) => ({ id: m.profile?.id ?? "", name: m.profile?.full_name ?? m.profile?.email ?? "—" }))
    .filter((p) => p.id)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div>
      <PageHeader
        title="Treinamentos"
        subtitle="Catálogo, obrigatoriedade por cargo e acompanhamento da conformidade."
      />
      <TrainingsManager
        trainings={trainings}
        myEnrollments={myEnrollments}
        enrollments={enrollments}
        podeCadastrar={podeCadastrar}
        currentUserId={user.id}
        people={people}
        departments={departments}
        subdepartments={subdepartments}
        positions={positions}
        pilares={pilaresOpt}
        units={unitScope.units}
      />
    </div>
  );
}
