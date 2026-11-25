import { requireContext, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import type { AgendaFull, LogRow, ChecklistSchedFull, ChecklistRunLite, OrgInfo, PlannerTaskLite } from "@/lib/agenda-types";
import type { Tables } from "@/types/database";
import { fetchAll, emLotes } from "@/lib/supabase/fetch-all";
import { responsaveisDaAgenda } from "@/lib/agenda-responsavel";

export type AgendaData = {
  currentUserId: string;
  isAdmin: boolean;
  today: string;
  people: { id: string; name: string }[];
  nameById: Record<string, string>;
  orgByUser: Record<string, OrgInfo>;
  reportIds: string[];
  agendas: AgendaFull[];
  logs: LogRow[];
  checklistScheds: ChecklistSchedFull[];
  checklistRuns: ChecklistRunLite[];
  /** tarefas do Planner com prazo, para o dia consolidar (fora da aderência) */
  plannerTasks: PlannerTaskLite[];
  holidays: { day: string; name: string }[];
  /** logs que já têm comentário ou anexo (a observação sai do próprio log). */
  logsComAnexoOuComentario: string[];
  /** De quem é o diário em tela (`?de=`), já conferido contra quem a pessoa alcança. */
  diarioDe: string;
  /**
   * Escolhe qualquer pessoa como responsável de agenda: Proprietário,
   * Administrador e DP (LUIZ, 25/11/2026). Os demais, só a si e a própria equipe
   * (`reportIds`). O banco confere de novo (agenda_checar_responsavel).
   */
  escolheQualquerResponsavel: boolean;
};

export type SecaoAgenda = "diario" | "agendas" | "equipe" | "historico";

/**
 * Lê `?de=` do diário. Só o formato: quem pode ver quem é decidido dentro do
 * `loadAgendaData`, com a mesma régua do seletor da tela.
 */
export function diarioDeDaUrl(de: string | string[] | undefined): string | null {
  const v = Array.isArray(de) ? de[0] : de;
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

/**
 * Carrega o que cada tela de Gestão da rotina precisa (RLS aplicada).
 *
 * Por seção (desempenho, LUIZ 18/11/2026). As quatro telas recebiam a mesma
 * carga, 814 KB, quase metade só de registros de 90 dias da empresa toda
 * (2.340 linhas em 18/11/2026):
 * - Agendas (cadastro) não usa registro, checklist, Planner nem comentário: não
 *   busca nenhum deles.
 * - Diário mostra UMA pessoa por vez. Quem só enxerga a si mesmo continua igual
 *   (a RLS já recorta); quem enxerga outras pessoas (gestor, gerencial, admin)
 *   recebe só os registros das agendas da pessoa em tela, escolhida por `?de=`.
 * - Equipe e Histórico precisam de todo mundo que a pessoa alcança: seguem com
 *   a carga inteira.
 */
export async function loadAgendaData(secao: SecaoAgenda, de: string | null = null): Promise<AgendaData> {
  const { user, tenant, role, unitScope, isDp } = await requireContext();
  const supabase = await createClient();
  const isAdmin = role === "owner" || role === "admin";
  const comRegistros = secao !== "agendas";
  // Funcionário não tem cadeia: o diário dele é só ele, e a RLS já entrega só o
  // dele. Os outros perfis podem trocar de pessoa, e aí o recorte é aqui.
  const diarioDeUmaPessoa = secao === "diario" && role !== "member";
  const nada = Promise.resolve({ data: null });

  // `agendas` tem unidade e a tela ignorava o seletor do topo. Mesma regra das
  // demais telas com unidade: agenda sem unidade aparece em qualquer recorte.
  const unidadesDoEscopo = effectiveUnitFilter(unitScope);
  const agendaUnitOr = unidadesDoEscopo ? `unit_id.in.(${unidadesDoEscopo.join(",")}),unit_id.is.null` : null;

  const today = new Date().toLocaleDateString("sv-SE");
  const fromD = new Date(); fromD.setDate(fromD.getDate() - 90);
  const from = fromD.toLocaleDateString("sv-SE");
  const fromIso = fromD.toISOString();

  const [agendaRes, logRes, schedRes, runRes, holidayRes, membershipRes, reportRes, comentRes, anexoRes, plTaskRes, plAssigneeRes, plBoardRes, respRes] = await Promise.all([
    (() => {
      const q = supabase.from("agendas").select("*, agenda_tasks(*)").eq("tenant_id", tenant.id);
      return (agendaUnitOr ? q.or(agendaUnitOr) : q).order("created_at", { ascending: false });
    })(),
    // fetchAll: 90 dias de logs já passam de 2 mil linhas (12/11/2026), e o
    // PostgREST entregava só 1000, sem ordem, a quem enxerga a empresa toda.
    // A aderência e o histórico saíam com dias faltando, sem aviso.
    // No diário de quem alcança outras pessoas, os registros saem depois, só os
    // da pessoa em tela (abaixo).
    comRegistros && !diarioDeUmaPessoa
      ? fetchAll(() => supabase.from("agenda_logs").select(COLUNAS_DO_LOG).eq("tenant_id", tenant.id).gte("log_date", from).order("id"))
      : nada,
    comRegistros
      ? supabase.from("checklist_schedules").select("id, frequency, fixed_date, weekday, day_of_month, run_time, active, checklist_id, checklists!inner(name, active), checklist_schedule_targets(kind, ref_id)").eq("active", true)
      : nada,
    comRegistros
      ? supabase.from("checklist_runs").select("checklist_id, executor_id, period_key").not("completed_at", "is", null).gte("created_at", fromIso)
      : nada,
    comRegistros ? supabase.from("holidays").select("day, name").eq("tenant_id", tenant.id) : nada,
    // lotação e nome numa leitura só (antes eram duas: getMembers e esta)
    fetchAll(() => supabase
      .from("memberships")
      .select("user_id, position_id, department_id, profiles!memberships_user_id_fkey(id, full_name, email)")
      .eq("tenant_id", tenant.id)
      .eq("is_active", true)
      .order("id")),
    supabase.rpc("my_managed_memberships").eq("tenant_id", tenant.id),
    // Só o `log_id`, e na mesma janela de 90 dias dos logs: é o que o ícone de
    // detalhe precisa para acender sem abrir a tarefa. A RLS já recorta.
    comRegistros ? supabase.from("agenda_log_comments").select("log_id").gte("created_at", fromIso) : nada,
    comRegistros ? supabase.from("agenda_log_attachments").select("log_id").gte("created_at", fromIso) : nada,
    // Planner no diário: só tarefas COM prazo, na mesma janela de 90 dias dos
    // logs. A RLS já recorta para os quadros que este usuário enxerga (os
    // dele + os da cadeia, se gestor), então o gestor vê o dia do subordinado
    // com as tarefas do subordinado, sem query especial.
    comRegistros ? supabase.from("planner_tasks").select("id, title, due_date, progress, board_id").not("due_date", "is", null).gte("due_date", from) : nada,
    comRegistros ? supabase.from("planner_task_assignees").select("task_id, user_id") : nada,
    comRegistros ? supabase.from("planner_boards").select("id, name") : nada,
    // quem foi responsável por cada agenda em cada período (transferência com data)
    supabase.from("agenda_responsaveis").select("agenda_id, user_id, de, ate").eq("tenant_id", tenant.id).order("de"),
  ]);

  type VinculoComPerfil = {
    user_id: string; position_id: string | null; department_id: string | null;
    profiles: { id: string; full_name: string | null; email: string | null } | null;
  };
  const vinculos = (membershipRes.data ?? []) as unknown as VinculoComPerfil[];
  const people = vinculos
    .map((m) => m.profiles)
    .filter((p): p is NonNullable<VinculoComPerfil["profiles"]> => !!p)
    .map((p) => ({ id: p.id, name: p.full_name ?? p.email ?? "Usuário" }));
  const nameById: Record<string, string> = Object.fromEntries(people.map((p) => [p.id, p.name]));

  const orgByUser: Record<string, OrgInfo> = {};
  for (const m of vinculos) orgByUser[m.user_id] = { positionId: m.position_id, departmentId: m.department_id };
  const reportIds = (reportRes.data ?? []).map((r) => r.user_id);

  type AgendaRow = Tables<"agendas"> & { agenda_tasks: Tables<"agenda_tasks">[] };
  const periodosPorAgenda = new Map<string, Tables<"agenda_responsaveis">[]>();
  for (const p of (respRes.data ?? []) as Tables<"agenda_responsaveis">[]) {
    const lista = periodosPorAgenda.get(p.agenda_id) ?? [];
    lista.push(p);
    periodosPorAgenda.set(p.agenda_id, lista);
  }
  const agendas: AgendaFull[] = ((agendaRes.data ?? []) as unknown as AgendaRow[]).map((a) => ({
    id: a.id, name: a.name, description: a.description, unitId: a.unit_id, unitName: null,
    ownerId: a.owner_id, ownerName: nameById[a.owner_id] ?? "Usuário",
    responsibleId: a.responsible_id, responsibleName: nameById[a.responsible_id] ?? "Usuário",
    canResponsibleEdit: a.can_responsible_edit, active: a.active, createdDate: (a.created_at ?? "").slice(0, 10),
    imprevistos: a.imprevistos ?? false,
    periodosInativa: (a.periodos_inativa as { de: string; ate: string | null }[] | null) ?? [],
    responsaveis: (periodosPorAgenda.get(a.id) ?? []).map((p) => ({
      userId: p.user_id, nome: nameById[p.user_id] ?? "Usuário", de: p.de, ate: p.ate,
    })),
    tasks: (a.agenda_tasks ?? []).slice().sort((x, y) => x.sort - y.sort).map((t) => ({
      id: t.id, title: t.title, description: t.description, scheduledTime: t.scheduled_time,
      durationMinutes: t.duration_minutes, frequency: t.frequency, weekdays: t.weekdays ?? [],
      dayOfMonth: t.day_of_month, fixedDate: t.fixed_date, active: t.active, flexible: t.flexible ?? false,
      vigenteDe: t.vigente_de, vigenteAte: t.vigente_ate,
    })),
  }));

  // De quem é o diário: a mesma régua do seletor da tela (admin alcança a
  // empresa, os outros a própria cadeia). Fora dela, volta para a própria pessoa,
  // e a tela recebe os registros de quem ela de fato mostra.
  const alcancaveis = new Set(isAdmin ? people.map((p) => p.id) : reportIds);
  const diarioDe = de && de !== user.id && alcancaveis.has(de) ? de : user.id;

  let linhasDeLog = (logRes.data ?? []) as LogDb[];
  if (diarioDeUmaPessoa) {
    const daPessoa = agendas.filter((a) => responsaveisDaAgenda(a).includes(diarioDe)).map((a) => a.id);
    const r = daPessoa.length === 0
      ? { data: [] as LogDb[] }
      : await emLotes(daPessoa, (lote) => fetchAll(() => supabase
          .from("agenda_logs")
          .select(COLUNAS_DO_LOG)
          .eq("tenant_id", tenant.id)
          .in("agenda_id", lote)
          .gte("log_date", from)
          .order("id")));
    linhasDeLog = (r.data ?? []) as LogDb[];
  }

  const logs: LogRow[] = linhasDeLog.map((l) => ({
    id: l.id, agendaId: l.agenda_id, taskId: l.task_id, logDate: l.log_date,
    status: l.status, note: l.note, actualMinutes: l.actual_minutes,
  }));

  type SchedRow = {
    id: string; frequency: ChecklistSchedFull["frequency"]; fixed_date: string | null; weekday: number | null;
    day_of_month: number | null; run_time: string | null; checklist_id: string;
    checklists: { name: string; active: boolean } | null;
    checklist_schedule_targets: { kind: string; ref_id: string }[];
  };
  const checklistScheds: ChecklistSchedFull[] = ((schedRes.data ?? []) as unknown as SchedRow[])
    .filter((s) => s.checklists?.active)
    .map((s) => ({
      checklistId: s.checklist_id, checklistName: s.checklists?.name ?? "Checklist", scheduleId: s.id,
      frequency: s.frequency, fixedDate: s.fixed_date, weekday: s.weekday, dayOfMonth: s.day_of_month, runTime: s.run_time,
      targets: (s.checklist_schedule_targets ?? []).map((t) => ({ kind: t.kind, refId: t.ref_id })),
    }));

  const checklistRuns: ChecklistRunLite[] = (runRes.data ?? []).map((r) => ({
    checklistId: r.checklist_id, executorId: r.executor_id, periodKey: r.period_key ?? "",
  }));

  const holidays = (holidayRes.data ?? []).map((h) => ({ day: h.day, name: h.name }));

  const logsComAnexoOuComentario = [...new Set([
    ...(comentRes.data ?? []).map((c) => c.log_id),
    ...(anexoRes.data ?? []).map((a) => a.log_id),
  ])];

  const assigneesPorTask = new Map<string, string[]>();
  for (const a of plAssigneeRes.data ?? []) {
    const arr = assigneesPorTask.get(a.task_id) ?? [];
    arr.push(a.user_id);
    assigneesPorTask.set(a.task_id, arr);
  }
  const boardNome = new Map((plBoardRes.data ?? []).map((b) => [b.id, b.name]));
  const plannerTasks: PlannerTaskLite[] = (plTaskRes.data ?? [])
    .map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.due_date as string,
      done: t.progress === "done",
      boardId: t.board_id,
      boardName: boardNome.get(t.board_id) ?? "Planner",
      assigneeIds: assigneesPorTask.get(t.id) ?? [],
    }))
    .filter((t) => t.assigneeIds.length > 0);

  return { currentUserId: user.id, isAdmin, today, people, nameById, orgByUser, reportIds, agendas, logs, checklistScheds, checklistRuns, plannerTasks, holidays, logsComAnexoOuComentario, diarioDe, escolheQualquerResponsavel: isDp };
}

const COLUNAS_DO_LOG = "id, agenda_id, task_id, log_date, status, note, actual_minutes";
type LogDb = Pick<Tables<"agenda_logs">, "id" | "agenda_id" | "task_id" | "log_date" | "status" | "note" | "actual_minutes">;
