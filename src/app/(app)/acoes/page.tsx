import { requireContext, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { ActionsManager, type ActionRow, type FilterOptions } from "@/components/ActionsManager";
// de um módulo neutro, NÃO de ActionsManager: constante exportada de arquivo
// "use client" chega aqui como proxy de referência, e `.includes` estoura
import { MINHA_PARAM, resolverMinhas } from "@/lib/acoes-minhas";
import { Pager } from "@/components/ui/Pager";
import { moduleGate } from "@/lib/module-gate";
import { getPlatformIntegrationFlags } from "@/lib/platform-integrations";
import type { Tables } from "@/types/database";

const PAGE_SIZE = 50;

/** Multivalor chega como parâmetro repetido (?sol=A&sol=B) e vira string[]. */
type SP = {
  p?: string; q?: string; sdpo?: string; de?: string; ate?: string;
  st?: string | string[]; prog?: string | string[];
  pilar?: string | string[]; bloco?: string | string[]; item?: string | string[];
  kpi?: string | string[]; ferr?: string | string[]; reuniao?: string | string[];
  sol?: string | string[]; resp?: string | string[];
  setor?: string | string[]; sub?: string | string[];
  minhas?: string | string[];
};

const asList = (v: string | string[] | undefined): string[] =>
  v == null ? [] : Array.isArray(v) ? v.filter(Boolean) : v ? [v] : [];

export default async function ActionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const gate = await moduleGate("acoes");
  if (gate) return gate;

  const { tenant, user, role, unitScope } = await requireContext();
  const supabase = await createClient();
  const isAdmin = role === "owner" || role === "admin";
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p) || 1);
  const from = (page - 1) * PAGE_SIZE;

  /**
   * "Minhas ações": o PADRÃO da tela, e não um filtro que a pessoa precisa achar.
   *
   * Parâmetro AUSENTE vale `resp`, porque quem entra em Ações quase sempre quer o
   * que está no colo dele. Desligar é explícito (`?minhas=todas`), senão não teria
   * como distinguir "abri a tela agora" de "pedi para ver tudo".
   *
   * Isto é EXIBIÇÃO, não permissão: quem alcançava as 7.522 ações continua
   * alcançando, a um clique em "Todas". A regra de quem vê o quê segue no banco.
   */
  const mine = resolverMinhas(asList(sp.minhas));

  // filtros vivem na URL: a busca é feita no banco, sobre a base inteira
  const filters = {
    q: sp.q ?? "", sdpo: sp.sdpo ?? "", from: sp.de ?? "", to: sp.ate ?? "",
    status: asList(sp.st), programa: asList(sp.prog),
    pilar: asList(sp.pilar), bloco: asList(sp.bloco), item: asList(sp.item),
    kpi: asList(sp.kpi), tool: asList(sp.ferr), meeting: asList(sp.reuniao),
    requester: asList(sp.sol), assignee: asList(sp.resp),
    dept: asList(sp.setor), sub: asList(sp.sub),
    mine,
  };

  const unitIds = effectiveUnitFilter(unitScope);
  const unitById = new Map(unitScope.units.map((u) => [u.id, u.name]));

  // Só a leitura das AÇÕES depende da busca: ela precisa dos ids. Todo o resto
  // (catálogos, nomes, opções de filtro, flag de IA) não depende de nada e por isso
  // sai na mesma hora, em vez de esperar a busca terminar para só então começar.
  // Antes eram 6 idas ao banco em fila; agora a página espera a mais lenta, não a soma.
  const searchP = supabase.rpc("search_action_ids", {
    p_filters: { ...filters, units: unitIds ?? null },
    p_limit: PAGE_SIZE,
    p_offset: from,
  });
  const flagsP = getPlatformIntegrationFlags();
  const catalogosP = Promise.all([
    supabase.from("sdpo_programas").select("id, name").eq("tenant_id", tenant.id).order("name"),
    supabase.from("sdpo_pilares").select("id, name, active").eq("tenant_id", tenant.id).order("name"),
    supabase.from("sdpo_secoes").select("id, name, active").eq("tenant_id", tenant.id).order("name"),
    supabase.from("sdpo_blocos").select("id, name, pilar_id, secao_id, active").eq("tenant_id", tenant.id).order("name"),
    supabase.from("sdpo_itens").select("id, name, pilar_id, secao_id, bloco_id, active").eq("tenant_id", tenant.id).order("name"),
    supabase.from("departments").select("id, name").eq("tenant_id", tenant.id).eq("active", true).order("name"),
    supabase.from("subdepartments").select("id, name, department_id").eq("tenant_id", tenant.id).eq("active", true).order("name"),
    supabase.from("action_kpis").select("id, name, active").eq("tenant_id", tenant.id).order("name"),
    supabase.from("action_tools").select("id, name, active").eq("tenant_id", tenant.id).order("name"),
    supabase.from("meeting_series").select("id, name").eq("tenant_id", tenant.id).is("deleted_at", null).order("name"),
    supabase.from("meeting_occurrences").select("id, series_id, occurred_on").eq("tenant_id", tenant.id).is("deleted_at", null).order("occurred_on", { ascending: false }).limit(500),
    // UMA consulta só, com is_active junto: os ativos alimentam o seletor de
    // pessoas e a lista inteira resolve o nome de autores já desligados. Antes
    // eram duas consultas quase idênticas, e a segunda repetia ~84 KB de nomes.
    supabase.from("memberships").select("user_id, is_active, profiles!memberships_user_id_fkey(full_name)").eq("tenant_id", tenant.id),
    // opções dos selects a partir da base inteira (não só da página)
    supabase.rpc("action_filter_options"),
  ]);

  const { data: search } = await searchP;
  const { ids: pageIds, total: actionsTotal } = (search ?? { ids: [], total: 0 }) as { ids: string[]; total: number };

  const [
    { data: actionsRaw },
    [
      { data: programas }, { data: pilares }, { data: secoes }, { data: blocos }, { data: itens },
      { data: deps }, { data: subs },
      { data: kpis }, { data: tools }, { data: seriesData }, { data: occData },
      { data: profilesData }, { data: filterOpts },
    ],
    flags,
  ] = await Promise.all([
    pageIds.length
      ? supabase.from("actions").select("*").in("id", pageIds)
      : Promise.resolve({ data: [] as Tables<"actions">[] }),
    catalogosP,
    flagsP,
  ]);

  // a busca devolve os ids já ordenados; o .in() não preserva ordem
  const orderById = new Map(pageIds.map((id, i) => [id, i]));
  const actions = [...(actionsRaw ?? [])].sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0));

  const actionIds = actions.map((a) => a.id);
  const [{ data: demandas }, { data: ccs }, { data: atts }] = await Promise.all([
    actionIds.length ? supabase.from("action_demandas").select("id, action_id, description, status, due_date, legacy_assignees").in("action_id", actionIds) : Promise.resolve({ data: [] as { id: string; action_id: string; description: string; status: string; due_date: string | null; legacy_assignees: string | null }[] }),
    actionIds.length ? supabase.from("action_cc").select("action_id, user_id").in("action_id", actionIds) : Promise.resolve({ data: [] as { action_id: string; user_id: string }[] }),
    actionIds.length ? supabase.from("action_attachments").select("id, action_id, demanda_id, filename, path").in("action_id", actionIds) : Promise.resolve({ data: [] as { id: string; action_id: string; demanda_id: string | null; filename: string; path: string }[] }),
  ]);

  const demandaIds = (demandas ?? []).map((d) => d.id);
  const [{ data: assigneeRows }, { data: commentRows }] = demandaIds.length
    ? await Promise.all([
        supabase.from("action_demanda_assignees").select("demanda_id, user_id, done_requested_at, completed_at").in("demanda_id", demandaIds),
        // só o id: a contagem é feita aqui, sem trazer o corpo dos comentários
        supabase.from("demanda_events").select("demanda_id").eq("type", "comment").in("demanda_id", demandaIds),
      ])
    : [
        { data: [] as { demanda_id: string; user_id: string; done_requested_at: string | null; completed_at: string | null }[] },
        { data: [] as { demanda_id: string }[] },
      ];

  // mapas de nomes
  const nameById = new Map((profilesData ?? []).map((m) => [m.user_id, (m.profiles as { full_name: string | null } | null)?.full_name ?? "—"]));
  const programaName = new Map((programas ?? []).map((p) => [p.id, p.name]));
  const pilarName = new Map((pilares ?? []).map((p) => [p.id, p.name]));
  const secaoName = new Map((secoes ?? []).map((s) => [s.id, s.name]));
  const blocoName = new Map((blocos ?? []).map((b) => [b.id, b.name]));
  const itemName = new Map((itens ?? []).map((i) => [i.id, i.name]));
  const kpiName = new Map((kpis ?? []).map((k) => [k.id, k.name]));
  const toolName = new Map((tools ?? []).map((t) => [t.id, t.name]));
  const seriesName = new Map((seriesData ?? []).map((s) => [s.id, s.name]));
  const occDate = new Map((occData ?? []).map((o) => [o.id, o.occurred_on]));

  const assigneesByDemanda = new Map<string, string[]>();
  const assigneeIdsByDemanda = new Map<string, string[]>();
  const assigneeStatesByDemanda = new Map<string, { id: string; name: string; doneRequestedAt: string | null; completedAt: string | null }[]>();
  for (const r of assigneeRows ?? []) {
    const arr = assigneesByDemanda.get(r.demanda_id) ?? [];
    arr.push(nameById.get(r.user_id) ?? "—");
    assigneesByDemanda.set(r.demanda_id, arr);
    const ids = assigneeIdsByDemanda.get(r.demanda_id) ?? [];
    ids.push(r.user_id);
    assigneeIdsByDemanda.set(r.demanda_id, ids);
    const st = assigneeStatesByDemanda.get(r.demanda_id) ?? [];
    st.push({ id: r.user_id, name: nameById.get(r.user_id) ?? "—", doneRequestedAt: r.done_requested_at, completedAt: r.completed_at });
    assigneeStatesByDemanda.set(r.demanda_id, st);
  }
  // "Aguardando aprovação": responsável que enviou a parte (done_requested_at) sem aprovação (completed_at).
  const pendingByDemanda = new Map<string, number>();
  for (const r of assigneeRows ?? []) {
    if (r.done_requested_at && !r.completed_at) pendingByDemanda.set(r.demanda_id, (pendingByDemanda.get(r.demanda_id) ?? 0) + 1);
  }
  // quantidade de comentários por demanda: mostra na lista se a ação tem acompanhamento
  const commentsByDemanda = new Map<string, number>();
  for (const c of commentRows ?? []) {
    commentsByDemanda.set(c.demanda_id, (commentsByDemanda.get(c.demanda_id) ?? 0) + 1);
  }
  // anexos por demanda e gerais (demanda_id null)
  const attsByDemanda = new Map<string, { id: string; filename: string; path: string }[]>();
  for (const a of atts ?? []) {
    if (!a.demanda_id) continue;
    const arr = attsByDemanda.get(a.demanda_id) ?? [];
    arr.push({ id: a.id, filename: a.filename, path: a.path });
    attsByDemanda.set(a.demanda_id, arr);
  }
  const demandasByAction = new Map<string, ActionRow["demandas"]>();
  for (const d of demandas ?? []) {
    const arr = demandasByAction.get(d.action_id) ?? [];
    const legacyResp = (d.legacy_assignees ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    arr.push({
      id: d.id, description: d.description, status: d.status, dueDate: d.due_date,
      assigneeNames: [...(assigneesByDemanda.get(d.id) ?? []), ...legacyResp],
      assigneeIds: assigneeIdsByDemanda.get(d.id) ?? [],
      assigneeStates: assigneeStatesByDemanda.get(d.id) ?? [],
      pendingCount: pendingByDemanda.get(d.id) ?? 0,
      commentCount: commentsByDemanda.get(d.id) ?? 0,
      attachments: attsByDemanda.get(d.id) ?? [],
    });
    demandasByAction.set(d.action_id, arr);
  }
  const ccByAction = new Map<string, string[]>();
  for (const c of ccs ?? []) {
    const arr = ccByAction.get(c.action_id) ?? [];
    arr.push(nameById.get(c.user_id) ?? "—");
    ccByAction.set(c.action_id, arr);
  }
  const attsByAction = new Map<string, { id: string; filename: string; path: string }[]>();
  for (const a of atts ?? []) {
    if (a.demanda_id) continue; // só anexos gerais
    const arr = attsByAction.get(a.action_id) ?? [];
    arr.push({ id: a.id, filename: a.filename, path: a.path });
    attsByAction.set(a.action_id, arr);
  }

  const rows: ActionRow[] = actions.map((a) => ({
    id: a.id,
    code: a.code,
    isSdpo: a.is_sdpo,
    programaName: (a.programa_id ? programaName.get(a.programa_id) ?? null : null) ?? a.legacy_programa ?? null,
    pilarName: (a.pilar_id ? pilarName.get(a.pilar_id) ?? null : null) ?? a.legacy_pilar ?? null,
    secaoName: (a.secao_id ? secaoName.get(a.secao_id) ?? null : null) ?? a.legacy_secao ?? null,
    blocoName: (a.bloco_id ? blocoName.get(a.bloco_id) ?? null : null) ?? a.legacy_bloco ?? null,
    itemName: (a.item_id ? itemName.get(a.item_id) ?? null : null) ?? a.legacy_item ?? null,
    seriesName: (a.meeting_series_id ? seriesName.get(a.meeting_series_id) ?? null : null) ?? a.legacy_meeting ?? null,
    occurredOn: a.occurrence_id ? occDate.get(a.occurrence_id) ?? null : null,
    kpiName: (a.kpi_id ? kpiName.get(a.kpi_id) ?? null : null) ?? a.legacy_kpi ?? null,
    toolName: (a.tool_id ? toolName.get(a.tool_id) ?? null : null) ?? a.legacy_tool ?? null,
    unitName: (a.unit_id ? unitById.get(a.unit_id) ?? null : null) ?? a.legacy_unit ?? null,
    requesterId: a.requester_id,
    createdById: a.created_by,
    requesterName: (a.requester_id ? nameById.get(a.requester_id) ?? null : null) ?? a.legacy_requester ?? null,
    problem: a.problem_statement,
    createdAt: a.created_at,
    priority: a.priority,
    dueDate: a.due_date,
    demandas: demandasByAction.get(a.id) ?? [],
    ccNames: ccByAction.get(a.id) ?? [],
    attachments: attsByAction.get(a.id) ?? [],
  }));

  // mantém os filtros ao trocar de página (multivalor vira parâmetro repetido)
  const pagerQuery = new URLSearchParams();
  for (const [k, v] of Object.entries({ q: sp.q, sdpo: sp.sdpo, de: sp.de, ate: sp.ate })) {
    if (v) pagerQuery.set(k, v as string);
  }
  // `minhas` entra aqui como veio da URL, e não resolvido: trocar de página não
  // pode transformar um "Todas" explícito no padrão de novo
  for (const [k, v] of Object.entries({ st: sp.st, prog: sp.prog, pilar: sp.pilar, bloco: sp.bloco, item: sp.item, setor: sp.setor, sub: sp.sub, kpi: sp.kpi, ferr: sp.ferr, reuniao: sp.reuniao, sol: sp.sol, resp: sp.resp, [MINHA_PARAM]: sp.minhas })) {
    asList(v).forEach((x) => pagerQuery.append(k, x));
  }

  return (
    <>
      <ActionsManager
        actions={rows}
        currentUserId={user.id}
        isAdmin={isAdmin}
        isOwner={role === "owner"}
        units={unitScope.units}
        aiEnabled={flags.hasOpenAI}
        filters={filters}
        filterOptions={{
          // as listas em uso saem da RPC (só o que existe nas ações); setor e
          // subsetor saem do CADASTRO, senão o filtro nasceria vazio: a coluna é
          // nova e as 7,5 mil ações antigas não têm setor nenhum
          ...((filterOpts ?? { programas: [], pilares: [], blocos: [], itens: [], kpis: [], tools: [], meetings: [], requesters: [], assignees: [] }) as FilterOptions),
          departments: (deps ?? []).map((d) => ({ id: d.id, nome: d.name })),
          subdepartments: (subs ?? []).map((x) => ({ id: x.id, nome: x.name, deptId: x.department_id })),
        }}
        total={actionsTotal}
      />
      <Pager basePath="/acoes" param="p" page={page} pageSize={PAGE_SIZE} total={actionsTotal} extra={pagerQuery} />
    </>
  );
}
