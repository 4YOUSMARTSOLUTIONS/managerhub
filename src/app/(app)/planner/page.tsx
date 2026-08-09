import { requireContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { moduleGate } from "@/lib/module-gate";
import { PageHeader } from "@/components/ui/PageHeader";
import { PlannerManager, type BoardListItem } from "@/components/PlannerManager";
import type { BoardBucket, BoardTask } from "@/components/planner/BoardView";
import type { AcaoCard } from "@/components/planner/ActionsBoard";
import type { DemandaInfo } from "@/components/DemandaPanel";
import type { Enums } from "@/types/database";

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

/** done antigos saem do board: a coluna Concluída não pode crescer sem fim */
const JANELA_CONCLUIDA_DIAS = 30;
const TETO_DE_CARTOES = 300;

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

  const visao = sp.visao === "acoes" || sp.visao === "ambas" ? sp.visao : "atividades";

  // ------------------------------------------------------- visão de Ações
  // As MINHAS demandas, carregadas direto pela RLS (sem search_action_ids): a
  // unidade do kanban é a demanda do usuário, não a página de ações. O que
  // desce é o DemandaInfo completo, para o clique abrir o MESMO painel de
  // tratamento da tela de Ações.
  const nomear = async (
    tabela: "sdpo_pilares" | "sdpo_secoes" | "sdpo_blocos" | "sdpo_itens" | "action_kpis" | "action_tools",
    ids: string[],
  ) => (ids.length ? supabase.from(tabela).select("id, name").in("id", ids) : { data: [] as { id: string; name: string }[] });

  let acoesCards: AcaoCard[] = [];
  if (visao !== "atividades") {
    const { data: minhas } = await supabase
      .from("action_demanda_assignees")
      .select("demanda_id")
      .eq("user_id", user.id);
    const meusIds = [...new Set((minhas ?? []).map((m) => m.demanda_id))];
    if (meusIds.length) {
      const corte = new Date(Date.now() - JANELA_CONCLUIDA_DIAS * 86_400_000).toISOString();
      const { data: demandas } = await supabase
        .from("action_demandas")
        .select("id, action_id, description, status, due_date, completed_at")
        .in("id", meusIds)
        .neq("status", "cancelled")
        .or("status.neq.done,completed_at.gte." + corte)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(TETO_DE_CARTOES);
      const demandaIds = (demandas ?? []).map((d) => d.id);
      const actionIds = [...new Set((demandas ?? []).map((d) => d.action_id))];

      const [{ data: acts }, { data: assigneeRows }, { data: atts }, { data: ccs }] = await Promise.all([
        actionIds.length
          ? supabase.from("actions").select("id, code, is_sdpo, pilar_id, secao_id, bloco_id, item_id, kpi_id, tool_id, meeting_series_id, occurrence_id, requester_id, problem_statement, priority, legacy_pilar, legacy_secao, legacy_bloco, legacy_item, legacy_kpi, legacy_tool, legacy_meeting, legacy_requester").in("id", actionIds)
          : Promise.resolve({ data: [] as never[] }),
        demandaIds.length
          ? supabase.from("action_demanda_assignees").select("demanda_id, user_id, done_requested_at, completed_at").in("demanda_id", demandaIds)
          : Promise.resolve({ data: [] as never[] }),
        demandaIds.length
          ? supabase.from("action_attachments").select("id, demanda_id, filename, path").in("demanda_id", demandaIds)
          : Promise.resolve({ data: [] as never[] }),
        actionIds.length
          ? supabase.from("action_cc").select("action_id, user_id").in("action_id", actionIds)
          : Promise.resolve({ data: [] as never[] }),
      ]);

      // mapas de nomes só dos ids presentes
      const so = (v: (string | null)[]) => [...new Set(v.filter(Boolean) as string[])];
      const a = acts ?? [];
      const [{ data: pil }, { data: sec }, { data: blo }, { data: ite }, { data: kpi }, { data: too }, { data: ser }, { data: occ }] = await Promise.all([
        nomear("sdpo_pilares", so(a.map((x) => x.pilar_id))),
        nomear("sdpo_secoes", so(a.map((x) => x.secao_id))),
        nomear("sdpo_blocos", so(a.map((x) => x.bloco_id))),
        nomear("sdpo_itens", so(a.map((x) => x.item_id))),
        nomear("action_kpis", so(a.map((x) => x.kpi_id))),
        nomear("action_tools", so(a.map((x) => x.tool_id))),
        so(a.map((x) => x.meeting_series_id)).length
          ? supabase.from("meeting_series").select("id, name").in("id", so(a.map((x) => x.meeting_series_id)))
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        so(a.map((x) => x.occurrence_id)).length
          ? supabase.from("meeting_occurrences").select("id, occurred_on").in("id", so(a.map((x) => x.occurrence_id)))
          : Promise.resolve({ data: [] as { id: string; occurred_on: string }[] }),
      ]);
      const nm = (rows: { id: string; name: string }[] | null) => new Map((rows ?? []).map((r) => [r.id, r.name]));
      const pilN = nm(pil), secN = nm(sec), bloN = nm(blo), iteN = nm(ite), kpiN = nm(kpi), tooN = nm(too), serN = nm(ser);
      const occN = new Map((occ ?? []).map((o) => [o.id, o.occurred_on]));

      const porDemanda = new Map<string, { id: string; name: string; doneRequestedAt: string | null; completedAt: string | null }[]>();
      for (const r of assigneeRows ?? []) {
        const arr = porDemanda.get(r.demanda_id) ?? [];
        arr.push({ id: r.user_id, name: nomeDe.get(r.user_id) ?? "—", doneRequestedAt: r.done_requested_at, completedAt: r.completed_at });
        porDemanda.set(r.demanda_id, arr);
      }
      const attsPorDemanda = new Map<string, { id: string; filename: string; path: string }[]>();
      for (const x of atts ?? []) {
        if (!x.demanda_id) continue;
        const arr = attsPorDemanda.get(x.demanda_id) ?? [];
        arr.push({ id: x.id, filename: x.filename, path: x.path });
        attsPorDemanda.set(x.demanda_id, arr);
      }
      const ccPorAcao = new Map<string, string[]>();
      for (const c of ccs ?? []) {
        const arr = ccPorAcao.get(c.action_id) ?? [];
        arr.push(nomeDe.get(c.user_id) ?? "—");
        ccPorAcao.set(c.action_id, arr);
      }
      const acaoDe = new Map(a.map((x) => [x.id, x]));

      acoesCards = (demandas ?? []).flatMap((d) => {
        const acao = acaoDe.get(d.action_id);
        if (!acao) return [];
        const estados = porDemanda.get(d.id) ?? [];
        const demanda: DemandaInfo = {
          id: d.id,
          label: "#" + acao.code,
          description: d.description,
          status: d.status as Enums<"action_status">,
          dueDate: d.due_date,
          priority: acao.priority,
          assigneeIds: estados.map((e) => e.id),
          assigneeNames: estados.map((e) => e.name),
          assigneeStates: estados,
          attachments: attsPorDemanda.get(d.id) ?? [],
          requesterName: (acao.requester_id ? nomeDe.get(acao.requester_id) ?? null : null) ?? acao.legacy_requester ?? null,
          problem: acao.problem_statement,
          ccNames: ccPorAcao.get(d.action_id) ?? [],
          isSdpo: acao.is_sdpo,
          pilarName: (acao.pilar_id ? pilN.get(acao.pilar_id) ?? null : null) ?? acao.legacy_pilar ?? null,
          secaoName: (acao.secao_id ? secN.get(acao.secao_id) ?? null : null) ?? acao.legacy_secao ?? null,
          blocoName: (acao.bloco_id ? bloN.get(acao.bloco_id) ?? null : null) ?? acao.legacy_bloco ?? null,
          itemName: (acao.item_id ? iteN.get(acao.item_id) ?? null : null) ?? acao.legacy_item ?? null,
          kpiName: (acao.kpi_id ? kpiN.get(acao.kpi_id) ?? null : null) ?? acao.legacy_kpi ?? null,
          toolName: (acao.tool_id ? tooN.get(acao.tool_id) ?? null : null) ?? acao.legacy_tool ?? null,
          seriesName: (acao.meeting_series_id ? serN.get(acao.meeting_series_id) ?? null : null) ?? acao.legacy_meeting ?? null,
          occurredOn: acao.occurrence_id ? occN.get(acao.occurrence_id) ?? null : null,
        };
        return [{
          demanda,
          requesterId: acao.requester_id,
          pending: estados.some((e) => e.doneRequestedAt && !e.completedAt),
        }];
      });
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
        visao={visao}
        acoesCards={acoesCards}
        isAdmin={isAdmin}
      />
    </div>
  );
}
