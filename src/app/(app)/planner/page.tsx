import { requireContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { moduleGate } from "@/lib/module-gate";
import { PageHeader } from "@/components/ui/PageHeader";
import { PlannerManager, type BoardListItem } from "@/components/PlannerManager";
import type { BoardBucket, BoardTask } from "@/components/planner/BoardView";

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

type SP = { quadro?: string; equipe?: string };

export default async function PlannerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const gate = await moduleGate("planner");
  if (gate) return gate;

  const { tenant, user } = await requireContext();
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

  const boards: BoardListItem[] = (boardsRaw ?? []).map((b) => {
    const memberIds = membrosPorQuadro.get(b.id) ?? [];
    return {
      id: b.id,
      name: b.name,
      description: b.description,
      createdBy: b.created_by,
      creatorName: nomeDe.get(b.created_by) ?? "",
      memberIds,
      participo: b.created_by === user.id || memberIds.includes(user.id),
    };
  });

  // o recorte do gestor: só subordinados podem ser alvo do filtro, e a lista de
  // opções sai da cadeia real, não de um campo livre
  const subordinados = new Set(
    (managedRaw ?? []).filter((m) => m.tenant_id === tenant.id).map((m) => m.user_id),
  );
  const teamOptions = [...subordinados]
    .map((id) => ({ id, name: nomeDe.get(id) ?? "" }))
    .filter((p) => p.name)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const equipe = sp.equipe && subordinados.has(sp.equipe) ? sp.equipe : "";

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
  if (selecionado) {
    const [{ data: bucketsRaw }, { data: tasksRaw }, { data: assigneesRaw }] = await Promise.all([
      supabase.from("planner_buckets").select("id, name, position").eq("board_id", selecionado.id).order("position"),
      supabase.from("planner_tasks")
        .select("id, bucket_id, title, description, due_date, priority, completed_at, position")
        .eq("board_id", selecionado.id).order("position"),
      supabase.from("planner_task_assignees").select("task_id, user_id").eq("board_id", selecionado.id),
    ]);
    const assigneesPorTask = new Map<string, { id: string; name: string }[]>();
    for (const a of assigneesRaw ?? []) {
      const arr = assigneesPorTask.get(a.task_id) ?? [];
      arr.push({ id: a.user_id, name: nomeDe.get(a.user_id) ?? "" });
      assigneesPorTask.set(a.task_id, arr);
    }
    buckets = (bucketsRaw ?? []).map((b) => ({ id: b.id, name: b.name, position: b.position }));
    tasks = (tasksRaw ?? []).map((t) => ({
      id: t.id,
      bucketId: t.bucket_id,
      title: t.title,
      description: t.description,
      dueDate: t.due_date,
      priority: t.priority,
      completedAt: t.completed_at,
      position: t.position,
      assignees: assigneesPorTask.get(t.id) ?? [],
    }));
  }

  // participantes do quadro aberto: são os únicos que podem ser responsáveis
  const participantes = selecionado
    ? [selecionado.createdBy, ...selecionado.memberIds]
        .map((id) => ({ id, name: nomeDe.get(id) ?? "" }))
        .filter((p) => p.name)
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    : [];

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
      />
    </div>
  );
}
