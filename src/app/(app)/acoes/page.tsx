import { requireContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { ActionsManager, type ActionRow } from "@/components/ActionsManager";
import type { Person } from "@/components/PeoplePicker";

export default async function ActionsPage() {
  const { tenant, user, role } = await requireContext();
  const supabase = await createClient();
  const isAdmin = role === "owner" || role === "admin";

  const [
    { data: actions }, { data: pilares }, { data: blocos }, { data: itens },
    { data: kpis }, { data: tools }, { data: seriesData }, { data: occData },
    { data: members }, { data: profilesData },
  ] = await Promise.all([
    supabase.from("actions").select("*").eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(300),
    supabase.from("sdpo_pilares").select("id, name").eq("tenant_id", tenant.id).order("name"),
    supabase.from("sdpo_blocos").select("id, name, pilar_id").eq("tenant_id", tenant.id).order("name"),
    supabase.from("sdpo_itens").select("id, name, bloco_id").eq("tenant_id", tenant.id).order("name"),
    supabase.from("action_kpis").select("id, name").eq("tenant_id", tenant.id).order("name"),
    supabase.from("action_tools").select("id, name").eq("tenant_id", tenant.id).order("name"),
    supabase.from("meeting_series").select("id, name").eq("tenant_id", tenant.id).order("name"),
    supabase.from("meeting_occurrences").select("id, series_id, occurred_on").eq("tenant_id", tenant.id).order("occurred_on", { ascending: false }).limit(500),
    supabase.from("memberships").select("user_id, profiles!memberships_user_id_fkey(full_name)").eq("tenant_id", tenant.id).eq("is_active", true),
    // nomes: todos os membros do tenant (inclui inativos, p/ resolver autores antigos)
    supabase.from("memberships").select("user_id, profiles!memberships_user_id_fkey(full_name)").eq("tenant_id", tenant.id),
  ]);

  const actionIds = (actions ?? []).map((a) => a.id);
  const [{ data: demandas }, { data: ccs }, { data: atts }] = await Promise.all([
    actionIds.length ? supabase.from("action_demandas").select("id, action_id, description, status, due_date").in("action_id", actionIds) : Promise.resolve({ data: [] as { id: string; action_id: string; description: string; status: string; due_date: string | null }[] }),
    actionIds.length ? supabase.from("action_cc").select("action_id, user_id").in("action_id", actionIds) : Promise.resolve({ data: [] as { action_id: string; user_id: string }[] }),
    actionIds.length ? supabase.from("action_attachments").select("id, action_id, demanda_id, filename, path").in("action_id", actionIds) : Promise.resolve({ data: [] as { id: string; action_id: string; demanda_id: string | null; filename: string; path: string }[] }),
  ]);

  const demandaIds = (demandas ?? []).map((d) => d.id);
  const [{ data: assigneeRows }, { data: pendingReqs }] = demandaIds.length
    ? await Promise.all([
        supabase.from("action_demanda_assignees").select("demanda_id, user_id").in("demanda_id", demandaIds),
        supabase.from("demanda_requests").select("demanda_id").eq("status", "pending").in("demanda_id", demandaIds),
      ])
    : [{ data: [] as { demanda_id: string; user_id: string }[] }, { data: [] as { demanda_id: string }[] }];

  // mapas de nomes
  const nameById = new Map((profilesData ?? []).map((m) => [m.user_id, (m.profiles as { full_name: string | null } | null)?.full_name ?? "—"]));
  const pilarName = new Map((pilares ?? []).map((p) => [p.id, p.name]));
  const blocoName = new Map((blocos ?? []).map((b) => [b.id, b.name]));
  const itemName = new Map((itens ?? []).map((i) => [i.id, i.name]));
  const kpiName = new Map((kpis ?? []).map((k) => [k.id, k.name]));
  const toolName = new Map((tools ?? []).map((t) => [t.id, t.name]));
  const seriesName = new Map((seriesData ?? []).map((s) => [s.id, s.name]));
  const occDate = new Map((occData ?? []).map((o) => [o.id, o.occurred_on]));

  const assigneesByDemanda = new Map<string, string[]>();
  const assigneeIdsByDemanda = new Map<string, string[]>();
  for (const r of assigneeRows ?? []) {
    const arr = assigneesByDemanda.get(r.demanda_id) ?? [];
    arr.push(nameById.get(r.user_id) ?? "—");
    assigneesByDemanda.set(r.demanda_id, arr);
    const ids = assigneeIdsByDemanda.get(r.demanda_id) ?? [];
    ids.push(r.user_id);
    assigneeIdsByDemanda.set(r.demanda_id, ids);
  }
  const pendingByDemanda = new Map<string, number>();
  for (const r of pendingReqs ?? []) pendingByDemanda.set(r.demanda_id, (pendingByDemanda.get(r.demanda_id) ?? 0) + 1);
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
    arr.push({
      id: d.id, description: d.description, status: d.status, dueDate: d.due_date,
      assigneeNames: assigneesByDemanda.get(d.id) ?? [],
      assigneeIds: assigneeIdsByDemanda.get(d.id) ?? [],
      pendingCount: pendingByDemanda.get(d.id) ?? 0,
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

  const rows: ActionRow[] = (actions ?? []).map((a) => ({
    id: a.id,
    code: a.code,
    isSdpo: a.is_sdpo,
    pilarName: a.pilar_id ? pilarName.get(a.pilar_id) ?? null : null,
    blocoName: a.bloco_id ? blocoName.get(a.bloco_id) ?? null : null,
    itemName: a.item_id ? itemName.get(a.item_id) ?? null : null,
    seriesName: a.meeting_series_id ? seriesName.get(a.meeting_series_id) ?? null : null,
    occurredOn: a.occurrence_id ? occDate.get(a.occurrence_id) ?? null : null,
    kpiName: a.kpi_id ? kpiName.get(a.kpi_id) ?? null : null,
    toolName: a.tool_id ? toolName.get(a.tool_id) ?? null : null,
    requesterId: a.requester_id,
    requesterName: a.requester_id ? nameById.get(a.requester_id) ?? null : null,
    priority: a.priority,
    dueDate: a.due_date,
    demandas: demandasByAction.get(a.id) ?? [],
    ccNames: ccByAction.get(a.id) ?? [],
    attachments: attsByAction.get(a.id) ?? [],
  }));

  const people: Person[] = (members ?? [])
    .map((m) => ({ id: m.user_id, name: (m.profiles as { full_name: string | null } | null)?.full_name ?? "—" }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <ActionsManager
      actions={rows}
      currentUserId={user.id}
      isAdmin={isAdmin}
      people={people}
      pilares={(pilares ?? []).map((p) => ({ id: p.id, name: p.name }))}
      blocos={(blocos ?? []).map((b) => ({ id: b.id, name: b.name, pilarId: b.pilar_id }))}
      itens={(itens ?? []).map((i) => ({ id: i.id, name: i.name, blocoId: i.bloco_id }))}
      kpis={(kpis ?? []).map((k) => ({ id: k.id, name: k.name }))}
      tools={(tools ?? []).map((t) => ({ id: t.id, name: t.name }))}
      series={(seriesData ?? []).map((s) => ({ id: s.id, name: s.name }))}
      occurrences={(occData ?? []).map((o) => ({ id: o.id, seriesId: o.series_id, occurredOn: o.occurred_on }))}
      aiEnabled={tenant.has_openai_key}
    />
  );
}
