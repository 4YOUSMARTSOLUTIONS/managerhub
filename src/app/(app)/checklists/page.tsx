import { requireContext, getMembers, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { purgeStaleChecklistDrafts } from "@/lib/actions/checklists";
import { ChecklistsManager, type ChecklistTemplate, type RunRow, type TaskRow, type Opt } from "@/components/ChecklistsManager";
import { moduleGate } from "@/lib/module-gate";

/**
 * Teto do histórico carregado de uma vez.
 *
 * A consulta de execuções não tinha limite nenhum, e traz junto TODAS as respostas
 * e TODAS as fotos de cada execução. Uma empresa com 30 unidades executando
 * checklists diários chega a milhares de execuções em um ano, e a tela travaria.
 *
 * Hoje isso não corta nada (ainda não há execuções). Quando o módulo entrar em uso
 * de verdade, o certo é trocar o teto por um filtro de período com paginação.
 */
const TETO_HISTORICO = 400;

export default async function ChecklistsPage() {
  const gate = await moduleGate("checklists");
  if (gate) return gate;

  const { tenant, user, role, unitScope } = await requireContext();
  const isAdmin = role === "owner" || role === "admin";
  const supabase = await createClient();
  // A limpeza de rascunhos velhos e best-effort e o resultado nao e usado: nao ha
  // motivo para a tela inteira esperar um DELETE terminar antes de começar a ler.
  // Sai junto com as leituras; se falhar, o proximo carregamento tenta de novo.
  const purgaP = purgeStaleChecklistDrafts();
  const unitIds = effectiveUnitFilter(unitScope);
  const unitOr = unitIds ? `unit_id.in.(${unitIds.join(",")}),unit_id.is.null` : null;

  const clsQuery = supabase.from("checklists").select(
    "id, unit_id, name, description, department_id, subdepartment_id, visibility, default_assignee_id, auto_open_tasks, created_by, active, " +
    "unit:units(name), dept:departments(name), sub:subdepartments(name), creator:profiles!checklists_created_by_fkey(full_name), assignee:profiles!checklists_default_assignee_id_fkey(full_name), " +
    "items:checklist_items(id, section, sort, label, help, type, required, allow_photo, allow_na, require_note_on_nc, require_photo_on_nc, options), " +
    "audiences:checklist_audiences(kind, ref_id), " +
    "schedules:checklist_schedules(id, frequency, fixed_date, weekday, day_of_month, run_time, active, targets:checklist_schedule_targets(kind, ref_id))",
  ).eq("tenant_id", tenant.id).order("created_at", { ascending: false });

  const tasksQuery = supabase.from("checklist_tasks").select(
    "id, checklist_id, run_id, item_id, unit_id, title, description, assignee_id, status, resolution, created_by, created_at, resolved_at, " +
    "checklist:checklists(name), unit:units(name), assignee:profiles!checklist_tasks_assignee_id_fkey(full_name), creator:profiles!checklist_tasks_created_by_fkey(full_name), " +
    "comments:checklist_task_comments(id, author_id, body, created_at, author:profiles!checklist_task_comments_author_id_fkey(full_name))",
  ).eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(TETO_HISTORICO);

  const runsQuery = supabase.from("checklist_runs").select(
    "id, checklist_id, executor_id, unit_id, period_key, status, score, conform_count, nonconform_count, na_count, started_at, completed_at, " +
    "executor:profiles!checklist_runs_executor_id_fkey(full_name), unit:units(name), " +
    "answers:checklist_run_answers(item_id, value_conformidade, value_bool, value_text, value_number, value_option, note), " +
    "photos:checklist_answer_photos(id, item_id, path, filename)",
  ).eq("tenant_id", tenant.id).order("completed_at", { ascending: false }).order("created_at", { ascending: false }).limit(TETO_HISTORICO);

  const [{ data: cls }, { data: myMem }, { data: reports }, membersAll, { data: deps }, { data: subs }, { data: pos }, { data: runsData }, { data: tasksData }] = await Promise.all([
    // (a purga corre em paralelo; o await dela vem no fim, sem segurar nada)
    unitOr ? clsQuery.or(unitOr) : clsQuery,
    supabase.from("memberships").select("position_id, department_id, subdepartment_id").eq("tenant_id", tenant.id).eq("user_id", user.id).maybeSingle(),
    supabase.rpc("my_managed_memberships").eq("tenant_id", tenant.id),
    getMembers(tenant.id),
    supabase.from("departments").select("id, name").eq("tenant_id", tenant.id).order("name"),
    supabase.from("subdepartments").select("id, name, department_id").eq("tenant_id", tenant.id).order("name"),
    supabase.from("positions").select("id, name").eq("tenant_id", tenant.id).order("name"),
    unitOr ? runsQuery.or(unitOr) : runsQuery,
    unitOr ? tasksQuery.or(unitOr) : tasksQuery,
  ]);
  await purgaP;

  const name1 = (o: unknown) => (o as { name: string | null } | null)?.name ?? null;
  const fname = (o: unknown) => (o as { full_name: string | null } | null)?.full_name ?? null;

  type ClRow = {
    id: string; name: string; description: string | null; unit_id: string | null; department_id: string | null;
    subdepartment_id: string | null; visibility: ChecklistTemplate["visibility"]; default_assignee_id: string | null; auto_open_tasks: boolean; created_by: string; active: boolean;
    unit: unknown; dept: unknown; sub: unknown; creator: unknown; assignee: unknown; items: unknown; audiences: unknown; schedules: unknown;
  };
  type RunDbRow = {
    id: string; checklist_id: string; executor_id: string; unit_id: string | null; period_key: string | null; score: number | null;
    conform_count: number; nonconform_count: number; na_count: number; started_at: string | null; completed_at: string | null;
    executor: unknown; unit: unknown; answers: unknown; photos: unknown;
  };
  type TaskDbRow = {
    id: string; checklist_id: string; run_id: string; item_id: string; unit_id: string | null; title: string; description: string | null;
    assignee_id: string | null; status: TaskRow["status"]; resolution: string | null; created_by: string; created_at: string; resolved_at: string | null;
    checklist: unknown; unit: unknown; assignee: unknown; creator: unknown; comments: unknown;
  };

  const checklists: ChecklistTemplate[] = ((cls ?? []) as unknown as ClRow[]).map((c) => ({
    id: c.id, name: c.name, description: c.description,
    unitId: c.unit_id, unitName: name1(c.unit), deptId: c.department_id, deptName: name1(c.dept),
    subId: c.subdepartment_id, subName: name1(c.sub),
    visibility: c.visibility, defaultAssigneeId: c.default_assignee_id, defaultAssigneeName: fname(c.assignee), autoOpenTasks: c.auto_open_tasks ?? true,
    createdBy: c.created_by, createdByName: fname(c.creator) ?? "—", active: c.active,
    items: ((c.items as unknown as { id: string; section: string | null; sort: number; label: string; help: string | null; type: ChecklistTemplate["items"][number]["type"]; required: boolean; allow_photo: boolean; allow_na: boolean; require_note_on_nc: boolean; require_photo_on_nc: boolean; options: unknown }[]) ?? [])
      .map((i) => ({ id: i.id, section: i.section, sort: i.sort, label: i.label, help: i.help, type: i.type, required: i.required, allowPhoto: i.allow_photo, allowNa: i.allow_na ?? true, requireNoteOnNc: i.require_note_on_nc ?? false, requirePhotoOnNc: i.require_photo_on_nc ?? false, options: (Array.isArray(i.options) ? i.options as string[] : null) }))
      .sort((a, b) => a.sort - b.sort),
    audiences: ((c.audiences as unknown as { kind: string; ref_id: string }[]) ?? []).map((a) => ({ kind: a.kind as "user" | "position" | "department", refId: a.ref_id })),
    schedules: ((c.schedules as unknown as { id: string; frequency: ChecklistTemplate["schedules"][number]["frequency"]; fixed_date: string | null; weekday: number | null; day_of_month: number | null; run_time: string | null; active: boolean; targets: { kind: string; ref_id: string }[] }[]) ?? [])
      .map((s) => ({ id: s.id, frequency: s.frequency, fixedDate: s.fixed_date, weekday: s.weekday, dayOfMonth: s.day_of_month, runTime: s.run_time, active: s.active, targets: (s.targets ?? []).map((t) => ({ kind: t.kind as "user" | "position" | "department", refId: t.ref_id })) })),
  }));

  const runs: RunRow[] = ((runsData ?? []) as unknown as RunDbRow[]).map((r) => ({
    id: r.id, checklistId: r.checklist_id, executorId: r.executor_id, executorName: fname(r.executor) ?? "—",
    unitId: r.unit_id, unitName: name1(r.unit), periodKey: r.period_key, score: r.score,
    conformCount: r.conform_count, nonconformCount: r.nonconform_count, naCount: r.na_count, startedAt: r.started_at, completedAt: r.completed_at,
    answers: ((r.answers as unknown as { item_id: string; value_conformidade: string | null; value_bool: boolean | null; value_text: string | null; value_number: number | null; value_option: string | null; note: string | null }[]) ?? [])
      .map((a) => ({ itemId: a.item_id, conformidade: a.value_conformidade, bool: a.value_bool, text: a.value_text, number: a.value_number, option: a.value_option, note: a.note })),
    photos: ((r.photos as unknown as { id: string; item_id: string; path: string; filename: string }[]) ?? []).map((p) => ({ id: p.id, itemId: p.item_id, path: p.path, filename: p.filename })),
  }));

  const tasks: TaskRow[] = ((tasksData ?? []) as unknown as TaskDbRow[]).map((t) => ({
    id: t.id, checklistId: t.checklist_id, checklistName: name1(t.checklist) ?? "—", runId: t.run_id, itemId: t.item_id,
    unitId: t.unit_id, unitName: name1(t.unit), title: t.title, description: t.description,
    assigneeId: t.assignee_id, assigneeName: fname(t.assignee), status: t.status, resolution: t.resolution,
    createdBy: t.created_by, createdByName: fname(t.creator) ?? "—", createdAt: t.created_at, resolvedAt: t.resolved_at,
    comments: ((t.comments as unknown as { id: string; author_id: string; body: string; created_at: string; author: unknown }[]) ?? [])
      .map((c) => ({ id: c.id, authorId: c.author_id, authorName: fname(c.author) ?? "—", body: c.body, createdAt: c.created_at }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }));

  const members: Opt[] = membersAll.map((m) => ({ id: m.profile?.id ?? "", name: m.profile?.full_name ?? m.profile?.email ?? "—" })).filter((m) => m.id).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const departments: Opt[] = (deps ?? []).map((d) => ({ id: d.id, name: d.name }));
  const subdepartments = (subs ?? []).map((s) => ({ id: s.id, name: s.name, departmentId: s.department_id }));
  const positions: Opt[] = (pos ?? []).map((p) => ({ id: p.id, name: p.name }));
  const units: Opt[] = unitScope.units.map((u) => ({ id: u.id, name: u.name }));
  const reportIds = (reports ?? []).map((r) => r.user_id);

  return (
    <div>
      <PageHeader title="Checklists" subtitle="Crie, agende e execute checklists da operação." />
      <ChecklistsManager
        checklists={checklists}
        runs={runs}
        tasks={tasks}
        members={members}
        departments={departments}
        subdepartments={subdepartments}
        positions={positions}
        units={units}
        currentUserId={user.id}
        isAdmin={isAdmin}
        reportIds={reportIds}
        myOrg={{ positionId: myMem?.position_id ?? null, departmentId: myMem?.department_id ?? null }}
        activeUnitId={unitScope.activeUnitId}
      />
    </div>
  );
}
