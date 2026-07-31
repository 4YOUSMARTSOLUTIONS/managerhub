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

  const [members, agendaRes, holidayRes, reportRes] = await Promise.all([
    getMembers(tenant.id),
    supabase.from("agendas").select("*, agenda_tasks(*)").eq("tenant_id", tenant.id).eq("active", true),
    supabase.from("holidays").select("day, name").eq("tenant_id", tenant.id),
    supabase.from("memberships").select("user_id").eq("tenant_id", tenant.id).eq("manager_id", user.id),
  ]);

  const people = members
    .map((m) => m.profile)
    .filter((p): p is Tables<"profiles"> => !!p)
    .map((p) => ({ id: p.id, name: p.full_name ?? p.email ?? "Usuário" }));
  const nameById: Record<string, string> = Object.fromEntries(people.map((p) => [p.id, p.name]));
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
