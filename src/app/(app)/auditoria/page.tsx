import { requireContext, getMembers } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AuditLogViewer, type AuditRow } from "@/components/AuditLogViewer";

export default async function AuditPage() {
  const { tenant, role } = await requireContext();
  const canView = role === "owner" || role === "admin" || role === "manager";

  if (!canView) {
    return (
      <div>
        <PageHeader title="Logs do sistema" />
        <EmptyState title="Acesso restrito" description="Apenas gestores e administradores podem ver os logs do sistema." />
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: logs }, members] = await Promise.all([
    supabase
      .from("audit_logs")
      .select("id, created_at, actor_id, action, entity_type, entity_id, entity_label, changes")
      .order("created_at", { ascending: false })
      .limit(300),
    getMembers(tenant.id),
  ]);

  const nameOf = new Map<string, string>();
  for (const m of members) if (m.profile?.id) nameOf.set(m.profile.id, m.profile.full_name ?? m.profile.email ?? "—");

  // resolve autores que não estão entre os membros (ex.: super admin)
  const missing = [...new Set((logs ?? []).map((l) => l.actor_id).filter((id): id is string => !!id && !nameOf.has(id)))];
  if (missing.length) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", missing);
    for (const p of profs ?? []) nameOf.set(p.id, p.full_name ?? p.email ?? "—");
  }

  const rows: AuditRow[] = (logs ?? []).map((l) => ({
    id: l.id,
    createdAt: l.created_at,
    actorName: l.actor_id ? nameOf.get(l.actor_id) ?? null : null,
    action: l.action,
    entityType: l.entity_type,
    entityLabel: l.entity_label,
    entityId: l.entity_id,
    changes: (l.changes as Record<string, unknown> | null) ?? null,
  }));

  return (
    <div>
      <PageHeader title="Logs do sistema" subtitle="Registro de todas as alterações feitas no sistema: quem, o quê, quando e onde." />
      <AuditLogViewer rows={rows} />
    </div>
  );
}
