import { requireContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { moduleGate } from "@/lib/module-gate";
import { PageHeader } from "@/components/ui/PageHeader";
import { PlannerManager, type BoardListItem } from "@/components/PlannerManager";
import type { BoardBucket, BoardTask } from "@/components/planner/BoardView";
import type { BoardLabel, ChecklistItem } from "@/components/planner/TaskDialog";
import type { MinhaTarefa } from "@/components/planner/MyTasksView";

/**
 * Planner: kanban de atividades por quadro.
 *
 * A RLS já entrega só os quadros visíveis (participante ∪ gestor de
 * participante), então a page não repete essa regra: ela decide apenas QUAL
 * quadro abrir e o que descer pré-mastigado para o cliente.
 *
 * `?quadro=` escolhe o quadro; `?equipe=<userId>` filtra a lista para os
 * quadros em que aquele subordinado participa (o recorte do gestor).
 */

type SP = { quadro?: string; equipe?: string; visao?: string };

export default async function PlannerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const gate = await moduleGate("planner");
  if (gate) return gate;

  const { tenant, user, role } = await requireContext();
  const isAdmin = role === "owner" || role === "admin";
  const supabase = await createClient();
  const sp = await searchParams;

  const [{ data: boardsRaw }, { data: membersRaw }, { data: peopleRaw }, { data: managedRaw }] = await Promise.all([
    supabase.from("planner_boards").select("id, name, description, created_by, created_at")
      .eq("tenant_id", tenant.id).order("created_at"),
    supabase.from("planner_board_members").select("board_id, user_id").eq("tenant_id", tenant.id),
    supabase.from("memberships")
      .select("user_id, is_active, profiles!memberships_user_id_fkey(full_name)")
      .eq("tenant_id", tenant.id).eq("is_active", true),
    // a cadeia inteira abaixo de mim; vazia para quem não é gestor
    supabase.rpc("my_managed_memberships"),
  ]);

  const nomeDe = new Map<string, string>();
  for (const m of peopleRaw ?? []) {
    const nm = (m.profiles as unknown as { full_name: string | null } | null)?.full_name;
    if (nm) nomeDe.set(m.user_id, nm);
  }
  const people = [...nomeDe]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const membrosPorQuadro = new Map<string, string[]>();
  for (const m of membersRaw ?? []) {
    const arr = membrosPorQuadro.get(m.board_id) ?? [];
    arr.push(m.user_id);
    membrosPorQuadro.set(m.board_id, arr);
  }

  // o recorte do gestor: só subordinados podem ser alvo do filtro, e a lista de
  // opções sai da cadeia real, não de um campo livre
  const subordinados = new Set(
    (managedRaw ?? []).filter((m) => m.tenant_id === tenant.id).map((m) => m.user_id),
  );

  const boards: BoardListItem[] = (boardsRaw ?? []).map((b) => {
    const memberIds = membrosPorQuadro.get(b.id) ?? [];
    const participo = b.created_by === user.id || memberIds.includes(user.id);
    return {
      id: b.id,
      name: b.name,
      description: b.description,
      createdBy: b.created_by,
      creatorName: nomeDe.get(b.created_by) ?? "",
      memberIds,
      participo,
      // espelha o círculo de escrita da RLS: participante, admin/owner, ou
      // gestor de alguém que participa
      podeEditar: participo || isAdmin
        || subordinados.has(b.created_by) || memberIds.some((id) => subordinados.has(id)),
    };
  });
  const teamOptions = [...subordinados]
    .map((id) => ({ id, name: nomeDe.get(id) ?? "" }))
    .filter((p) => p.name)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  // o próprio usuário também é alvo válido: "Meus quadros" é o filtro de quem
  // quer isolar o que É dele no meio do que ele enxerga da equipe
  const equipe = sp.equipe && (subordinados.has(sp.equipe) || sp.equipe === user.id) ? sp.equipe : "";

  const listados = equipe
    ? boards.filter((b) => b.createdBy === equipe || b.memberIds.includes(equipe))
    : boards;

  // quadro aberto: o da URL se está na lista; senão o primeiro em que participo;
  // senão o primeiro visível
  const selecionado =
    listados.find((b) => b.id === sp.quadro) ??
    listados.find((b) => b.participo) ??
    listados[0] ?? null;

  let buckets: BoardBucket[] = [];
  let tasks: BoardTask[] = [];
  let boardLabels: BoardLabel[] = [];
  const checklistPorTarefa: Record<string, ChecklistItem[]> = {};
  if (selecionado) {
    const [{ data: bucketsRaw }, { data: tasksRaw }, { data: assigneesRaw }, { data: labelsRaw }, { data: taskLabelsRaw }, { data: checklistRaw }] = await Promise.all([
      supabase.from("planner_buckets").select("id, name, position").eq("board_id", selecionado.id).order("position"),
      supabase.from("planner_tasks")
        .select("id, bucket_id, title, description, start_date, due_date, priority, progress, recurrence, completed_at, position")
        .eq("board_id", selecionado.id).order("position"),
      supabase.from("planner_task_assignees").select("task_id, user_id").eq("board_id", selecionado.id),
      supabase.from("planner_labels").select("id, name, color").eq("board_id", selecionado.id).order("name"),
      supabase.from("planner_task_labels").select("task_id, label_id").eq("board_id", selecionado.id),
      supabase.from("planner_checklist_items").select("id, task_id, title, done, position").eq("board_id", selecionado.id).order("position"),
    ]);
    const assigneesPorTask = new Map<string, { id: string; name: string }[]>();
    for (const a of assigneesRaw ?? []) {
      const arr = assigneesPorTask.get(a.task_id) ?? [];
      arr.push({ id: a.user_id, name: nomeDe.get(a.user_id) ?? "" });
      assigneesPorTask.set(a.task_id, arr);
    }
    boardLabels = (labelsRaw ?? []).map((l) => ({ id: l.id, name: l.name, color: l.color }));
    const labelDe = new Map(boardLabels.map((l) => [l.id, l]));
    const labelsPorTask = new Map<string, BoardLabel[]>();
    for (const tl of taskLabelsRaw ?? []) {
      const l = labelDe.get(tl.label_id);
      if (!l) continue;
      const arr = labelsPorTask.get(tl.task_id) ?? [];
      arr.push(l);
      labelsPorTask.set(tl.task_id, arr);
    }
    for (const i of checklistRaw ?? []) {
      const arr = checklistPorTarefa[i.task_id] ?? (checklistPorTarefa[i.task_id] = []);
      arr.push({ id: i.id, title: i.title, done: i.done, position: i.position });
    }
    buckets = (bucketsRaw ?? []).map((b) => ({ id: b.id, name: b.name, position: b.position }));
    tasks = (tasksRaw ?? []).map((t) => {
      const check = checklistPorTarefa[t.id] ?? [];
      return {
        id: t.id,
        bucketId: t.bucket_id,
        title: t.title,
        description: t.description,
        startDate: t.start_date,
        dueDate: t.due_date,
        priority: t.priority,
        progress: t.progress,
        recurrence: t.recurrence,
        completedAt: t.completed_at,
        position: t.position,
        assignees: assigneesPorTask.get(t.id) ?? [],
        labels: labelsPorTask.get(t.id) ?? [],
        checklistDone: check.filter((c) => c.done).length,
        checklistTotal: check.length,
      };
    });
  }

  // participantes do quadro aberto: são os únicos que podem ser responsáveis
  const participantes = selecionado
    ? [selecionado.createdBy, ...selecionado.memberIds]
        .map((id) => ({ id, name: nomeDe.get(id) ?? "" }))
        .filter((p) => p.name)
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    : [];

  const visao = sp.visao === "calendario" || sp.visao === "graficos" || sp.visao === "minhas" ? sp.visao : "quadro";

  // ------------------------------------------------- Minhas tarefas (cross-board)
  // Tudo em que sou responsável, em qualquer quadro que a RLS me deixe ver. Os
  // nomes dos quadros já estão na lista carregada acima; só os buckets faltam.
  let minhasTarefas: MinhaTarefa[] = [];
  if (visao === "minhas") {
    const { data: meus } = await supabase
      .from("planner_task_assignees").select("task_id").eq("user_id", user.id);
    const ids = [...new Set((meus ?? []).map((m) => m.task_id))];
    if (ids.length) {
      const { data: ts } = await supabase
        .from("planner_tasks")
        .select("id, title, due_date, priority, progress, board_id, bucket_id")
        .in("id", ids)
        .order("due_date", { ascending: true, nullsFirst: false });
      const bucketIds = [...new Set((ts ?? []).map((t) => t.bucket_id))];
      const { data: bks } = bucketIds.length
        ? await supabase.from("planner_buckets").select("id, name").in("id", bucketIds)
        : { data: [] as { id: string; name: string }[] };
      const bucketNome = new Map((bks ?? []).map((b) => [b.id, b.name]));
      const boardNome = new Map(boards.map((b) => [b.id, b.name]));
      minhasTarefas = (ts ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        dueDate: t.due_date,
        priority: t.priority,
        progress: t.progress,
        boardId: t.board_id,
        boardName: boardNome.get(t.board_id) ?? "",
        bucketName: bucketNome.get(t.bucket_id) ?? "",
      }));
    }
  }

  return (
    <div>
      <PageHeader title="Planner" subtitle="Quadros de atividades da sua equipe, no formato kanban." />
      <PlannerManager
        boards={listados}
        selectedBoardId={selecionado?.id ?? null}
        buckets={buckets}
        tasks={tasks}
        participantes={participantes}
        people={people}
        currentUserId={user.id}
        teamOptions={teamOptions}
        equipe={equipe}
        isAdmin={isAdmin}
        boardLabels={boardLabels}
        checklistPorTarefa={checklistPorTarefa}
        visao={visao}
        minhasTarefas={minhasTarefas}
      />
    </div>
  );
}
