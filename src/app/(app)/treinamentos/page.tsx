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
  type PersonOpt,
} from "@/components/TrainingsManager";
import type { SessionRow } from "@/components/TrainingSessionsManager";
import type { TrilhaRow } from "@/components/TrainingPathsPanel";

export default async function TreinamentosPage() {
  const gate = await moduleGate("treinamentos");
  if (gate) return gate;

  const { tenant, user, role, unitScope } = await requireContext();
  const podeCadastrar = role === "owner" || role === "admin" || role === "hr";
  const supabase = await createClient();

  const unitIdsDoEscopo = effectiveUnitFilter(unitScope);

  const cursosQuery = supabase
    .from("trainings")
    .select(
      "id, name, description, code, workload_minutes, delivery, validade_meses, antecipacao_dias, prazo_dias, " +
      "active, created_at, " +
      "owners:training_owners(user_id, unit_id), " +
      "rules:training_assignment_rules(kind, ref_id, mandatory), " +
      "escopos:training_scopes(kind, ref_id)",
    )
    .eq("tenant_id", tenant.id)
    .is("deleted_at", null)
    .order("name");

  const [
    { data: cursos },
    { data: minhas },
    { data: todasMatriculas },
    { data: vinculos },
    { data: vinculoUnidades },
    { data: deps },
    { data: subs },
    { data: cargos },
    { data: pilares },
    { data: turmas },
    { data: matriculasEmTurma },
    { data: salas },
    { data: trilhas },
  ] = await Promise.all([
    cursosQuery,
    // as minhas: a RLS já recorta, o filtro por user_id é só para não trazer a
    // equipe inteira de quem é gestor
    supabase
      .from("training_enrollments")
      .select("id, training_id, status, mandatory, due_at, completed_at, expires_at, score, session_id, cycle_no, path_id")
      .eq("tenant_id", tenant.id)
      .eq("user_id", user.id)
      .neq("status", "nao_aplicavel")
      .neq("status", "cancelado"),
    // o acompanhamento: quem não gere ninguém recebe só as próprias, por RLS
    supabase
      .from("training_enrollments")
      .select("id, training_id, user_id, status, mandatory, due_at, completed_at, expires_at, score, snap_department_id, applicable, path_id")
      .eq("tenant_id", tenant.id)
      .neq("status", "nao_aplicavel")
      .neq("status", "cancelado")
      .limit(5000),
    // lotação de quem está ativo: é o que permite oferecer, em "quem deve
    // fazer", só cargos e pessoas que existem dentro do escopo do treinamento
    supabase
      .from("memberships")
      .select("id, user_id, position_id, department_id, subdepartment_id, profiles!memberships_user_id_fkey(full_name, email)")
      .eq("tenant_id", tenant.id)
      .eq("is_active", true),
    supabase.from("membership_units").select("membership_id, unit_id").limit(20000),
    supabase.from("departments").select("id, name").eq("tenant_id", tenant.id).eq("active", true).order("name"),
    supabase.from("subdepartments").select("id, name, department_id").eq("tenant_id", tenant.id).eq("active", true).order("name"),
    supabase.from("positions").select("id, name").eq("tenant_id", tenant.id).eq("active", true).order("name"),
    supabase.from("sdpo_pilares").select("id, name").eq("tenant_id", tenant.id).eq("active", true).order("name"),
    // turmas com o que a lista precisa: instrutor, unidade e a contagem de
    // convocados e presença, para a aderência aparecer sem uma consulta por linha
    supabase
      .from("training_sessions")
      .select(
        "id, training_id, code, name, starts_at, ends_at, mode, room_id, meeting_url, location, instructor_id, unit_id, capacity, status, released_at, created_by, " +
        "trainings(name), unit:units(name), sala:rooms(name), " +
        "instrutor:profiles!training_sessions_instructor_id_fkey(full_name), " +
        "presencas:training_session_attendance(status)",
      )
      .eq("tenant_id", tenant.id)
      .order("starts_at", { ascending: false })
      .limit(300),
    supabase
      .from("training_enrollments")
      .select("session_id")
      .eq("tenant_id", tenant.id)
      .not("session_id", "is", null),
    // as mesmas salas das reuniões: turma presencial escolhe daqui
    supabase.from("rooms").select("id, name").eq("tenant_id", tenant.id).eq("is_active", true).order("name"),
    // trilhas com os passos já ordenados: o embed devolve na ordem do `order`
    supabase
      .from("training_paths")
      .select("id, name, description, prazo_dias, active, steps:training_path_steps(training_id, sort, required), rules:training_path_rules(kind, ref_id)")
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null)
      .order("name"),
  ]);

  type VinculoDb = {
    id: string; user_id: string;
    position_id: string | null; department_id: string | null; subdepartment_id: string | null;
    profiles: { full_name: string | null; email: string | null } | null;
  };
  const quadro = (vinculos ?? []) as unknown as VinculoDb[];

  const unidadesPorVinculo = new Map<string, string[]>();
  for (const vu of vinculoUnidades ?? []) {
    unidadesPorVinculo.set(vu.membership_id, [...(unidadesPorVinculo.get(vu.membership_id) ?? []), vu.unit_id]);
  }

  const nomePorUsuario = new Map<string, string>();
  for (const m of quadro) {
    nomePorUsuario.set(m.user_id, m.profiles?.full_name ?? m.profiles?.email ?? "—");
  }

  // O typegen não resolve embed de tabela cujas Relationships são declaradas
  // vazias (elas são mantidas à mão aqui). Mesmo padrão de /checklists: o
  // formato da linha é declarado uma vez e o cast acontece num ponto só.
  type CursoDb = {
    id: string; name: string; description: string | null; code: string | null;
    workload_minutes: number; delivery: TrainingRow["delivery"];
    validade_meses: number | null; antecipacao_dias: number; prazo_dias: number | null;
    active: boolean; created_at: string;
    owners: { user_id: string; unit_id: string | null }[] | null;
    rules: { kind: string; ref_id: string; mandatory: boolean }[] | null;
    escopos: { kind: string; ref_id: string }[] | null;
  };

  const nomeUnidade = new Map(unitScope.units.map((u) => [u.id, u.name]));
  const nomeSetor = new Map((deps ?? []).map((d) => [d.id, d.name]));
  const nomeSub = new Map((subs ?? []).map((x) => [x.id, x.name]));
  const nomePilar = new Map((pilares ?? []).map((p) => [p.id, p.name]));
  const nomesDoEscopo = (
    escopos: { kind: string; ref_id: string }[],
    kind: string,
    mapa: Map<string, string>,
  ) => escopos.filter((e) => e.kind === kind).map((e) => mapa.get(e.ref_id)).filter((n): n is string => !!n);
  // Sem nenhuma unidade marcada, o treinamento vale para a empresa toda e
  // aparece em qualquer recorte do seletor do topo. Com unidades marcadas, só
  // aparece quando pelo menos uma delas está no escopo ativo. O recorte é feito
  // aqui, e não no banco, porque a relação virou N:N e o `.or()` do PostgREST
  // não alcança tabela filha.
  const noEscopo = (us: string[]) =>
    !unitIdsDoEscopo || us.length === 0 || us.some((u) => unitIdsDoEscopo.includes(u));

  const trainings: TrainingRow[] = ((cursos ?? []) as unknown as CursoDb[])
    .map((t) => ({
      t,
      esc: t.escopos ?? [],
      us: (t.escopos ?? []).filter((e) => e.kind === "unit").map((e) => e.ref_id),
    }))
    .filter(({ us }) => noEscopo(us))
    .map(({ t, esc, us }) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    code: t.code,
    workloadMinutes: t.workload_minutes,
    delivery: t.delivery,
    validadeMeses: t.validade_meses,
    antecipacaoDias: t.antecipacao_dias,
    prazoDias: t.prazo_dias,
    unitNames: us.map((u) => nomeUnidade.get(u)).filter((n): n is string => !!n),
    deptNames: nomesDoEscopo(esc, "department", nomeSetor),
    subNames: nomesDoEscopo(esc, "subdepartment", nomeSub),
    pilarNames: nomesDoEscopo(esc, "pilar", nomePilar),
    active: t.active,
    // responsável geral primeiro, depois os de cada unidade com o nome dela
    ownerNames: (t.owners ?? []).map((o) => {
      const nome = nomePorUsuario.get(o.user_id) ?? "—";
      const un = o.unit_id ? nomeUnidade.get(o.unit_id) : null;
      return un ? `${nome} (${un})` : nome;
    }),
    ruleCount: (t.rules ?? []).length,
    mandatory: (t.rules ?? []).some((r) => r.mandatory),
  }));

  const cursoPorId = new Map(trainings.map((t) => [t.id, t]));

  // Bloqueio de pré-requisito, calculado aqui e não no cliente: o passo 2 só
  // abre com o passo 1 concluído, e a tela precisa saber disso para mostrar o
  // cadeado sem uma consulta por linha. Quem impede de fato é a guarda no banco.
  //
  // A ordem dos passos vem de `trilhas`, que já foi carregado acima; os cursos
  // que a pessoa cumpriu saem das próprias matrículas, sem ida extra ao banco.
  const cumpridosPorMim = new Set(
    (minhas ?? []).filter((e) => e.status === "concluido" || e.status === "isento")
      .map((e) => e.training_id),
  );
  type PassoLeve = { training_id: string; sort: number; required: boolean };
  const passosPorTrilha = new Map<string, PassoLeve[]>();
  for (const t of (trilhas ?? []) as unknown as { id: string; steps: PassoLeve[] | null }[]) {
    passosPorTrilha.set(t.id, [...(t.steps ?? [])].sort((a, b) => a.sort - b.sort));
  }
  const bloqueadaPorPreRequisito = (pathId: string | null, trainingId: string) => {
    if (!pathId) return false;
    const passos = passosPorTrilha.get(pathId) ?? [];
    const meu = passos.find((p) => p.training_id === trainingId);
    if (!meu) return false;
    return passos.some(
      (p) => p.sort < meu.sort && p.required
        && cursoPorId.get(p.training_id)?.active !== false
        && !cumpridosPorMim.has(p.training_id),
    );
  };

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
      pathId: e.path_id,
      bloqueada: bloqueadaPorPreRequisito(e.path_id, e.training_id),
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
      pathId: e.path_id,
    }));

  // Trilhas: os passos vêm do embed e precisam ser ordenados aqui, porque o
  // PostgREST não ordena tabela filha. `atribuidos` conta PESSOAS, não
  // matrículas: quatro passos da mesma pessoa são um colaborador em formação.
  type TrilhaDb = {
    id: string; name: string; description: string | null;
    prazo_dias: number | null; active: boolean;
    steps: { training_id: string; sort: number; required: boolean }[] | null;
    rules: { kind: string; ref_id: string }[] | null;
  };
  const pessoasPorTrilha = new Map<string, Set<string>>();
  for (const e of todasMatriculas ?? []) {
    if (!e.path_id) continue;
    const atual = pessoasPorTrilha.get(e.path_id) ?? new Set<string>();
    atual.add(e.user_id);
    pessoasPorTrilha.set(e.path_id, atual);
  }
  const paths: TrilhaRow[] = ((trilhas ?? []) as unknown as TrilhaDb[]).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    prazoDias: t.prazo_dias,
    active: t.active,
    passoNames: [...(t.steps ?? [])]
      .sort((a, b) => a.sort - b.sort)
      .map((p) => cursoPorId.get(p.training_id)?.name ?? "Treinamento removido"),
    ruleCount: (t.rules ?? []).length,
    atribuidos: pessoasPorTrilha.get(t.id)?.size ?? 0,
  }));

  // convocados por turma: uma contagem em memória em vez de N consultas
  const convocadosPorTurma = new Map<string, number>();
  for (const e of matriculasEmTurma ?? []) {
    if (e.session_id) convocadosPorTurma.set(e.session_id, (convocadosPorTurma.get(e.session_id) ?? 0) + 1);
  }

  type TurmaDb = {
    id: string; training_id: string; code: number; name: string | null;
    starts_at: string; ends_at: string | null;
    mode: SessionRow["mode"]; room_id: string | null; meeting_url: string | null;
    location: string | null; instructor_id: string | null; unit_id: string | null; capacity: number | null;
    status: SessionRow["status"]; released_at: string | null; created_by: string | null;
    trainings: { name: string } | null; unit: { name: string } | null; sala: { name: string } | null;
    instrutor: { full_name: string | null } | null;
    presencas: { status: "presente" | "ausente" | "justificado" }[] | null;
  };

  // quem administra o curso administra as turmas dele; o instrutor e quem criou
  // também. É o espelho de `pode_gerir_turma` no banco, só para a tela saber
  // quais botões mostrar (a trava de verdade continua na RLS).
  const cursosQueGerencio = new Set(
    ((cursos ?? []) as unknown as CursoDb[])
      .filter((t) => podeCadastrar || (t.owners ?? []).some((o) => o.user_id === user.id))
      .map((t) => t.id),
  );

  const sessions: SessionRow[] = ((turmas ?? []) as unknown as TurmaDb[]).map((s) => {
    const p = s.presencas ?? [];
    return {
      id: s.id,
      trainingId: s.training_id,
      trainingName: s.trainings?.name ?? "—",
      code: s.code,
      name: s.name,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      mode: s.mode,
      roomId: s.room_id,
      roomName: s.sala?.name ?? null,
      meetingUrl: s.meeting_url,
      location: s.location,
      instructorId: s.instructor_id,
      instructorName: s.instrutor?.full_name ?? null,
      unitName: s.unit?.name ?? null,
      capacity: s.capacity,
      status: s.status,
      releasedAt: s.released_at,
      convocados: convocadosPorTurma.get(s.id) ?? 0,
      presentes: p.filter((x) => x.status === "presente").length,
      ausentes: p.filter((x) => x.status === "ausente").length,
      justificados: p.filter((x) => x.status === "justificado").length,
      podeGerir: cursosQueGerencio.has(s.training_id) || s.instructor_id === user.id || s.created_by === user.id,
    };
  });

  const departments: Opt[] = (deps ?? []).map((d) => ({ id: d.id, name: d.name }));
  const subdepartments: SubOpt[] = (subs ?? []).map((s) => ({ id: s.id, name: s.name, departmentId: s.department_id }));
  const positions: Opt[] = (cargos ?? []).map((p) => ({ id: p.id, name: p.name }));
  const pilaresOpt: Opt[] = (pilares ?? []).map((p) => ({ id: p.id, name: p.name }));
  // cada pessoa carrega a própria lotação: o formulário usa isso para não
  // oferecer cargo ou colaborador que está fora do escopo do treinamento
  const people: PersonOpt[] = quadro
    .map((m) => ({
      id: m.user_id,
      name: m.profiles?.full_name ?? m.profiles?.email ?? "—",
      positionId: m.position_id,
      deptId: m.department_id,
      subId: m.subdepartment_id,
      unitIds: unidadesPorVinculo.get(m.id) ?? [],
    }))
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
        sessions={sessions}
        rooms={(salas ?? []).map((r) => ({ id: r.id, name: r.name }))}
        paths={paths}
      />
    </div>
  );
}
