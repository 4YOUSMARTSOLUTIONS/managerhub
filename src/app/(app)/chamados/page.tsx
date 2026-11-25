import { requireContext, getMembers, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { PageHeader } from "@/components/ui/PageHeader";
import type { Tab } from "@/components/ui/Tabs";
import { AbasDosChamados, TicketsManager, type TicketRow } from "@/components/TicketsManager";
import { TicketsDashboard } from "@/components/TicketsDashboard";
import { FiltrosChamadosProvider } from "@/components/FiltrosChamados";
import { TICKET_CATEGORY } from "@/lib/constants";
import { moduleGate } from "@/lib/module-gate";
import { ABRIR_CHAMADO } from "@/lib/notificacao-destino";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ [ABRIR_CHAMADO]?: string }> }) {
  const gate = await moduleGate("chamados");
  if (gate) return gate;
  // o aviso do sino leva ao chamado: `?chamado=<id>` abre a ficha dele
  const pedido = (await searchParams)[ABRIR_CHAMADO];
  const abrirId = pedido && UUID.test(pedido) ? pedido : null;

  const { tenant, user, role, unitScope } = await requireContext();
  const isAdmin = role === "owner" || role === "admin" || role === "manager";
  const supabase = await createClient();

  // escopo de chamados: owner/admin veem tudo; gestor vê só os setores que gerencia; demais só os que abriram
  const fullAccess = role === "owner" || role === "admin";
  const { data: myMgr } = await supabase
    .from("ticket_manager_sectors")
    .select("sector_id")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id);
  const managedSectorIds = (myMgr ?? []).map((r) => r.sector_id);

  const unitIds = effectiveUnitFilter(unitScope);
  // Lê tudo, sem o antigo `.limit(200)`: o Dashboard calcula sobre esta lista, e com
  // o histórico importado ele contaria só os 200 mais recentes. A descrição fica de
  // fora e vem ao abrir a ficha (`getTicketDetalhe`), para a carga não pesar.
  const COLUNAS =
    "id, code, title, status, priority, requested_priority, due_date, sector_id, category, category_id, unit_id, assignee_id, requester_id, created_at, resolved_at, updated_at, approval_requested_at, nps_score, nps_comment, origem_id, legacy_requester, legacy_assignee, legacy_unit, assignee:profiles!assignee_id(full_name), requester:profiles!requester_id(full_name), sector:ticket_sectors(name), cat:ticket_categories(name), unit:units(name)";
  // quem vê o quê: o mesmo recorte na lista e no chamado aberto pelo aviso
  const escopo = fullAccess
    ? null
    : managedSectorIds.length > 0
      ? `sector_id.in.(${managedSectorIds.join(",")}),requester_id.eq.${user.id}`
      : `requester_id.eq.${user.id}`;
  const montarChamados = () => {
    let q = supabase
      .from("tickets")
      .select(COLUNAS)
      .order("created_at", { ascending: false })
      .order("id");
    if (escopo) q = q.or(escopo);
    // chamado SEM unidade também entra: `.in()` sozinho descarta `null`, e um
    // chamado aberto sem unidade sumiria de todo recorte menos "Todas". Mesma
    // regra de /acoes e /checklists.
    return unitIds ? q.or(`unit_id.in.(${unitIds.join(",")}),unit_id.is.null`) : q;
  };

  // O chamado do aviso vem à parte: pode ser de outra unidade que não a do
  // seletor do topo, e ainda assim a pessoa precisa conseguir abri-lo.
  const montarPedido = () => {
    if (!abrirId) return Promise.resolve({ data: null });
    const q = supabase.from("tickets").select(COLUNAS).eq("id", abrirId);
    return (escopo ? q.or(escopo) : q).maybeSingle();
  };

  const [{ data: tickets }, members, { data: sectors }, { data: categories }, { data: units }, { data: slas }, { data: atts }, { data: pedidoAvulso }] =
    await Promise.all([
      fetchAll(montarChamados),
      getMembers(tenant.id),
      supabase.from("ticket_sectors").select("id, name, active").eq("tenant_id", tenant.id).order("name"),
      supabase.from("ticket_categories").select("id, name, sector_id, active").eq("tenant_id", tenant.id).order("name"),
      supabase.from("units").select("id, name").eq("tenant_id", tenant.id).order("name"),
      supabase.from("ticket_slas").select("category_id, priority, sla_value, sla_unit").eq("tenant_id", tenant.id),
      // sem `.in(ids)`: com milhares de chamados a URL estoura. O mapa abaixo só é
      // lido pelos chamados que a pessoa pode ver.
      fetchAll(() => supabase.from("ticket_attachments").select("id, ticket_id, path, filename, content_type").order("id")),
      montarPedido(),
    ]);

  const attByTicket = new Map<string, TicketRow["attachments"]>();
  for (const a of atts ?? []) {
    const arr = attByTicket.get(a.ticket_id) ?? [];
    arr.push({ id: a.id, path: a.path, filename: a.filename, contentType: a.content_type });
    attByTicket.set(a.ticket_id, arr);
  }

  const paraLinha = (t: NonNullable<typeof tickets>[number]): TicketRow => ({
    id: t.id,
    code: t.code,
    title: t.title,
    importado: t.origem_id != null,
    status: t.status,
    priority: t.priority,
    requestedPriority: t.requested_priority,
    dueDate: t.due_date,
    sectorId: t.sector_id,
    sectorName: (t.sector as unknown as { name: string } | null)?.name ?? (t.category ? TICKET_CATEGORY[t.category] : null),
    categoryId: t.category_id,
    categoryName: (t.cat as unknown as { name: string } | null)?.name ?? null,
    unitId: t.unit_id,
    unitName: (t.unit as unknown as { name: string } | null)?.name ?? t.legacy_unit,
    assigneeId: t.assignee_id,
    assigneeName: (t.assignee as unknown as { full_name: string | null } | null)?.full_name ?? t.legacy_assignee,
    requesterId: t.requester_id,
    requesterName: (t.requester as unknown as { full_name: string | null } | null)?.full_name ?? t.legacy_requester,
    createdAt: t.created_at,
    resolvedAt: t.resolved_at,
    updatedAt: t.updated_at,
    approvalRequestedAt: t.approval_requested_at,
    npsScore: t.nps_score,
    npsComment: t.nps_comment,
    attachments: attByTicket.get(t.id) ?? [],
  });
  const rows: TicketRow[] = (tickets ?? []).map(paraLinha);
  const abrir = abrirId
    ? rows.find((r) => r.id === abrirId) ?? (pedidoAvulso ? paraLinha(pedidoAvulso) : null)
    : null;

  const members2 = members
    .map((m) => ({ id: m.profile?.id ?? "", name: m.profile?.full_name ?? m.profile?.email ?? "—" }))
    .filter((m) => m.id)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const sectorOpts = (sectors ?? []).map((s) => ({ id: s.id, name: s.name, active: s.active }));
  const unitOpts = (units ?? []).map((u) => ({ id: u.id, name: u.name }));

  const tabs: Tab[] = [
    {
      id: "dashboard",
      label: "Dashboard",
      content: <TicketsDashboard tickets={rows} sectors={sectorOpts} />,
    },
    {
      id: "chamados",
      label: "Chamados",
      content: (
        <TicketsManager
          tickets={rows}
          sectors={sectorOpts}
          categories={(categories ?? []).map((c) => ({ id: c.id, name: c.name, sectorId: c.sector_id, active: c.active }))}
          units={unitOpts}
          slas={(slas ?? []).map((s) => ({ categoryId: s.category_id, priority: s.priority, value: s.sla_value, unit: s.sla_unit }))}
          slaMode={tenant.ticket_sla_mode === "category" ? "category" : "priority"}
          members={members2}
          currentUserId={user.id}
          isAdmin={isAdmin}
          fullAccess={fullAccess}
          isOwner={role === "owner"}
          managedSectorIds={managedSectorIds}
          abrir={abrir}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Chamados" subtitle="Solicitações de TI, Serviços Gerais e outras áreas." />
      <FiltrosChamadosProvider>
        <AbasDosChamados tabs={tabs} />
      </FiltrosChamadosProvider>
    </div>
  );
}
