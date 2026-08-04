import { requireContext, getMembers } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import type { AgendaFull, LogRow, ChecklistSchedFull, ChecklistRunLite, OrgInfo } from "@/lib/agenda-types";
import type { Tables } from "@/types/database";

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
  holidays: { day: string; name: string }[];
};

/** Carrega tudo que as telas de Gestão da rotina precisam (RLS aplicada). */
export async function loadAgendaData(): Promise<AgendaData> {
  const { user, tenant, role } = await requireContext();
  const supabase = await createClient();
  const isAdmin = role === "owner" || role === "admin";

  const today = new Date().toLocaleDateString("sv-SE");
  const fromD = new Date(); fromD.setDate(fromD.getDate() - 90);
  const from = fromD.toLocaleDateString("sv-SE");
  const fromIso = fromD.toISOString();

  const [members, agendaRes, logRes, schedRes, runRes, holidayRes, membershipRes, reportRes] = await Promise.all([
    getMembers(tenant.id),
    supabase.from("agendas").select("*, agenda_tasks(*)").eq("tenant_id", tenant.id).order("created_at", { ascending: false }),
    supabase.from("agenda_logs").select("id, agenda_id, task_id, log_date, status, note, actual_minutes").eq("tenant_id", tenant.id).gte("log_date", from),
    supabase.from("checklist_schedules").select("id, frequency, fixed_date, weekday, day_of_month, run_time, active, checklist_id, checklists!inner(name, active), checklist_schedule_targets(kind, ref_id)").eq("active", true),
    supabase.from("checklist_runs").select("checklist_id, executor_id, period_key").not("completed_at", "is", null).gte("created_at", fromIso),
    supabase.from("holidays").select("day, name").eq("tenant_id", tenant.id),
    supabase.from("memberships").select("user_id, position_id, department_id").eq("tenant_id", tenant.id).eq("is_active", true),
    supabase.rpc("my_managed_memberships").eq("tenant_id", tenant.id),
  ]);

  const people = members
    .map((m) => m.profile)
    .filter((p): p is Tables<"profiles"> => !!p)
    .map((p) => ({ id: p.id, name: p.full_name ?? p.email ?? "Usuário" }));
  const nameById: Record<string, string> = Object.fromEntries(people.map((p) => [p.id, p.name]));

  const orgByUser: Record<string, OrgInfo> = {};
  for (const m of membershipRes.data ?? []) orgByUser[m.user_id] = { positionId: m.position_id, departmentId: m.department_id };
  const reportIds = (reportRes.data ?? []).map((r) => r.user_id);

  type AgendaRow = Tables<"agendas"> & { agenda_tasks: Tables<"agenda_tasks">[] };
  const agendas: AgendaFull[] = ((agendaRes.data ?? []) as unknown as AgendaRow[]).map((a) => ({
    id: a.id, name: a.name, description: a.description, unitId: a.unit_id, unitName: null,
    ownerId: a.owner_id, ownerName: nameById[a.owner_id] ?? "Usuário",
    responsibleId: a.responsible_id, responsibleName: nameById[a.responsible_id] ?? "Usuário",
    canResponsibleEdit: a.can_responsible_edit, active: a.active, createdDate: (a.created_at ?? "").slice(0, 10),
    tasks: (a.agenda_tasks ?? []).slice().sort((x, y) => x.sort - y.sort).map((t) => ({
      id: t.id, title: t.title, description: t.description, scheduledTime: t.scheduled_time,
      durationMinutes: t.duration_minutes, frequency: t.frequency, weekdays: t.weekdays ?? [],
      dayOfMonth: t.day_of_month, fixedDate: t.fixed_date, active: t.active, flexible: t.flexible ?? false,
    })),
  }));

  const logs: LogRow[] = (logRes.data ?? []).map((l) => ({
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

  return { currentUserId: user.id, isAdmin, today, people, nameById, orgByUser, reportIds, agendas, logs, checklistScheds, checklistRuns, holidays };
}
