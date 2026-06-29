import { requireContext, getMembers } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { TicketsManager, type TicketRow } from "@/components/TicketsManager";
import { TICKET_CATEGORY } from "@/lib/constants";

export default async function TicketsPage() {
  const { tenant, user, role } = await requireContext();
  const isAdmin = role === "owner" || role === "admin" || role === "manager";
  const supabase = await createClient();

  const [{ data: tickets }, members, { data: sectors }, { data: categories }, { data: units }, { data: slas }] =
    await Promise.all([
      supabase
        .from("tickets")
        .select(
          "*, assignee:profiles!assignee_id(full_name), requester:profiles!requester_id(full_name), sector:ticket_sectors(name), cat:ticket_categories(name), unit:units(name)",
        )
        .order("created_at", { ascending: false })
        .limit(200),
      getMembers(tenant.id),
      supabase.from("ticket_sectors").select("id, name").eq("tenant_id", tenant.id).order("name"),
      supabase.from("ticket_categories").select("id, name, sector_id").eq("tenant_id", tenant.id).order("name"),
      supabase.from("units").select("id, name").eq("tenant_id", tenant.id).order("name"),
      supabase.from("ticket_slas").select("category_id, priority, sla_value, sla_unit").eq("tenant_id", tenant.id),
    ]);

  const ticketIds = (tickets ?? []).map((t) => t.id);
  const { data: atts } = ticketIds.length
    ? await supabase.from("ticket_attachments").select("id, ticket_id, path, filename, content_type").in("ticket_id", ticketIds)
    : { data: [] as { id: string; ticket_id: string; path: string; filename: string; content_type: string | null }[] };

  const attByTicket = new Map<string, TicketRow["attachments"]>();
  for (const a of atts ?? []) {
    const arr = attByTicket.get(a.ticket_id) ?? [];
    arr.push({ id: a.id, path: a.path, filename: a.filename, contentType: a.content_type });
    attByTicket.set(a.ticket_id, arr);
  }

  const rows: TicketRow[] = (tickets ?? []).map((t) => ({
    id: t.id,
    code: t.code,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    requestedPriority: t.requested_priority,
    dueDate: t.due_date,
    sectorId: t.sector_id,
    sectorName: (t.sector as unknown as { name: string } | null)?.name ?? (t.category ? TICKET_CATEGORY[t.category] : null),
    categoryId: t.category_id,
    categoryName: (t.cat as unknown as { name: string } | null)?.name ?? null,
    unitName: (t.unit as unknown as { name: string } | null)?.name ?? null,
    assigneeId: t.assignee_id,
    assigneeName: (t.assignee as { full_name: string | null } | null)?.full_name ?? null,
    requesterName: (t.requester as { full_name: string | null } | null)?.full_name ?? null,
    attachments: attByTicket.get(t.id) ?? [],
  }));

  const members2 = members
    .map((m) => ({ id: m.profile?.id ?? "", name: m.profile?.full_name ?? m.profile?.email ?? "—" }))
    .filter((m) => m.id);

  return (
    <div>
      <PageHeader title="Chamados" subtitle="Solicitações de TI, Serviços Gerais e outras áreas." />
      <TicketsManager
        tickets={rows}
        sectors={(sectors ?? []).map((s) => ({ id: s.id, name: s.name }))}
        categories={(categories ?? []).map((c) => ({ id: c.id, name: c.name, sectorId: c.sector_id }))}
        units={(units ?? []).map((u) => ({ id: u.id, name: u.name }))}
        slas={(slas ?? []).map((s) => ({ categoryId: s.category_id, priority: s.priority, value: s.sla_value, unit: s.sla_unit }))}
        members={members2}
        currentUserId={user.id}
        isAdmin={isAdmin}
      />
    </div>
  );
}
