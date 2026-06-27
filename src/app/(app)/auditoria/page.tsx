import { requireContext, getMembers } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDateTime } from "@/lib/format";
import type { Tone } from "@/lib/constants";

const ENTITY_LABEL: Record<string, string> = {
  rooms: "Sala",
  meetings: "Reunião",
  action_items: "Ação",
  tickets: "Chamado",
  goals: "Meta",
  goal_updates: "Progresso de meta",
  memberships: "Membro",
};

const ACTION_LABEL: Record<string, { label: string; tone: Tone }> = {
  INSERT: { label: "Criou", tone: "green" },
  UPDATE: { label: "Atualizou", tone: "amber" },
  DELETE: { label: "Removeu", tone: "red" },
};

export default async function AuditPage() {
  const { tenant, role } = await requireContext();
  const canView = role === "owner" || role === "admin" || role === "manager";

  if (!canView) {
    return (
      <div>
        <PageHeader title="Auditoria" />
        <EmptyState title="Acesso restrito" description="Apenas gestores e administradores podem ver o log de auditoria." />
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: logs }, members] = await Promise.all([
    supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(150),
    getMembers(tenant.id),
  ]);

  const nameOf = new Map(members.map((m) => [m.profile?.id, m.profile?.full_name]));

  return (
    <div>
      <PageHeader title="Auditoria" subtitle="Registro de todas as alterações feitas no sistema." />

      <Section title={`${logs?.length ?? 0} evento(s) recentes`} padded={false}>
        {logs && logs.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Autor</th>
                <th>Ação</th>
                <th>Tipo</th>
                <th>Registro</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => {
                const act = ACTION_LABEL[l.action] ?? { label: l.action, tone: "gray" as Tone };
                return (
                  <tr key={l.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatDateTime(l.created_at)}</td>
                    <td>{nameOf.get(l.actor_id ?? "") ?? <span className="soft">Sistema</span>}</td>
                    <td><Badge tone={act.tone}>{act.label}</Badge></td>
                    <td className="muted">{ENTITY_LABEL[l.entity_type] ?? l.entity_type}</td>
                    <td className="soft" style={{ fontVariantNumeric: "tabular-nums", fontSize: "0.78rem" }}>
                      {String(l.entity_id).slice(0, 8)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState title="Nenhum evento registrado" description="As ações dos usuários aparecerão aqui automaticamente." />
        )}
      </Section>
    </div>
  );
}
