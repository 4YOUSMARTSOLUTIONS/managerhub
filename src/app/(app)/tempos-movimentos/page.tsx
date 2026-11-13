import { requireContext, getMembers } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { TimeMotionManager } from "@/components/TimeMotionManager";
import type { AgendaFull } from "@/lib/agenda-types";
import type { Tables } from "@/types/database";
import { moduleGate } from "@/lib/module-gate";

export default async function TemposMovimentosPage() {
  const gate = await moduleGate("tempos_movimentos");
  if (gate) return gate;

  const { user, tenant, role } = await requireContext();
  const supabase = await createClient();
  const isAdmin = role === "owner" || role === "admin";
  const today = new Date().toLocaleDateString("sv-SE");

  const [members, agendaRes, holidayRes, reportRes, respRes] = await Promise.all([
    getMembers(tenant.id),
    // carga PLANEJADA: as demandas não previstas do atalho do diário ficam de fora
    // as inativas também: o passado delas conta até a inativação (agendaAtivaEm)
    supabase.from("agendas").select("*, agenda_tasks(*)").eq("tenant_id", tenant.id).eq("imprevistos", false),
    supabase.from("holidays").select("day, name").eq("tenant_id", tenant.id),
    supabase.rpc("my_managed_memberships").eq("tenant_id", tenant.id),
    // a carga de cada dia é de quem era o responsável naquele dia
    supabase.from("agenda_responsaveis").select("agenda_id, user_id, de, ate").eq("tenant_id", tenant.id).order("de"),
  ]);

  const people = members
    .map((m) => m.profile)
    .filter((p): p is Tables<"profiles"> => !!p)
    .map((p) => ({ id: p.id, name: p.full_name ?? p.email ?? "Usuário" }));
  const nameById: Record<string, string> = Object.fromEntries(people.map((p) => [p.id, p.name]));
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

  const holidays = (holidayRes.data ?? []).map((h) => ({ day: h.day, name: h.name }));

  return (
    <TimeMotionManager
      currentUserId={user.id}
      isAdmin={isAdmin}
      today={today}
      people={people}
      nameById={nameById}
      reportIds={reportIds}
      agendas={agendas}
      holidays={holidays}
    />
  );
}
