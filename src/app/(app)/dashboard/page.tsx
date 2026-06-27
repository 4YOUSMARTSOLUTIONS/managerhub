import Link from "next/link";
import { requireContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Section } from "@/components/ui/Section";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  ACTION_STATUS,
  ACTION_STATUS_TONE,
  TICKET_STATUS,
  TICKET_STATUS_TONE,
  TICKET_CATEGORY,
} from "@/lib/constants";
import { formatDate, formatDateTime, formatNumber, isOverdue } from "@/lib/format";

type Stats = {
  rooms_total: number;
  meetings_upcoming: number;
  meetings_today: number;
  actions_open: number;
  actions_overdue: number;
  tickets_open: number;
  tickets_overdue: number;
  goals_active: number;
  goals_at_risk: number;
  goals_achieved: number;
  members_total: number;
};

export default async function DashboardPage() {
  const { tenant } = await requireContext();
  const supabase = await createClient();

  const [{ data: statsRaw }, { data: meetings }, { data: actions }, { data: tickets }, { data: goals }] =
    await Promise.all([
      supabase.rpc("dashboard_stats", { p_tenant: tenant.id }),
      supabase
        .from("meetings")
        .select("id, title, starts_at, rooms(name)")
        .eq("status", "scheduled")
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(5),
      supabase
        .from("action_items")
        .select("id, title, due_date, status")
        .in("status", ["open", "in_progress", "blocked"])
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(5),
      supabase
        .from("tickets")
        .select("id, code, title, status, category")
        .in("status", ["open", "in_progress", "waiting"])
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("goals")
        .select("id, title, unit, target_value, current_value")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(4),
    ]);

  const s = (statsRaw ?? {}) as Stats;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Visão geral de ${tenant.name}`}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <StatCard label="Reuniões hoje" value={s.meetings_today ?? 0} hint={`${s.meetings_upcoming ?? 0} agendadas no total`} tone="blue" />
        <StatCard label="Salas ativas" value={s.rooms_total ?? 0} tone="purple" />
        <StatCard label="Ações abertas" value={s.actions_open ?? 0} hint={`${s.actions_overdue ?? 0} atrasadas`} tone={s.actions_overdue ? "red" : "amber"} />
        <StatCard label="Chamados abertos" value={s.tickets_open ?? 0} hint={`${s.tickets_overdue ?? 0} atrasados`} tone={s.tickets_overdue ? "red" : "amber"} />
        <StatCard label="Metas ativas" value={s.goals_active ?? 0} hint={`${s.goals_at_risk ?? 0} em risco`} tone="green" />
        <StatCard label="Membros" value={s.members_total ?? 0} tone="gray" />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: "1.25rem",
        }}
      >
        <Section title="Próximas reuniões" action={<Link href="/reunioes" className="btn btn-ghost btn-sm">Ver todas</Link>} padded={false}>
          {meetings && meetings.length > 0 ? (
            <table className="table">
              <tbody>
                {meetings.map((m) => (
                  <tr key={m.id}>
                    <td style={{ fontWeight: 500 }}>{m.title}</td>
                    <td className="muted">{(m.rooms as { name: string } | null)?.name ?? "—"}</td>
                    <td className="soft" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{formatDateTime(m.starts_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="Nenhuma reunião agendada" />
          )}
        </Section>

        <Section title="Ações pendentes" action={<Link href="/acoes" className="btn btn-ghost btn-sm">Ver todas</Link>} padded={false}>
          {actions && actions.length > 0 ? (
            <table className="table">
              <tbody>
                {actions.map((a) => (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 500 }}>{a.title}</td>
                    <td><Badge tone={ACTION_STATUS_TONE[a.status]}>{ACTION_STATUS[a.status]}</Badge></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap", color: isOverdue(a.due_date) ? "#dc2626" : "var(--text-soft)" }}>
                      {formatDate(a.due_date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="Nenhuma ação pendente" />
          )}
        </Section>

        <Section title="Chamados recentes" action={<Link href="/chamados" className="btn btn-ghost btn-sm">Ver todos</Link>} padded={false}>
          {tickets && tickets.length > 0 ? (
            <table className="table">
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id}>
                    <td className="soft" style={{ fontVariantNumeric: "tabular-nums" }}>{t.code}</td>
                    <td style={{ fontWeight: 500 }}>{t.title}</td>
                    <td className="muted">{TICKET_CATEGORY[t.category]}</td>
                    <td style={{ textAlign: "right" }}><Badge tone={TICKET_STATUS_TONE[t.status]}>{TICKET_STATUS[t.status]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="Nenhum chamado aberto" />
          )}
        </Section>

        <Section title="Progresso das metas" action={<Link href="/metas" className="btn btn-ghost btn-sm">Ver todas</Link>}>
          {goals && goals.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {goals.map((g) => {
                const pct = g.target_value > 0 ? Math.min(100, Math.round((g.current_value / g.target_value) * 100)) : 0;
                return (
                  <div key={g.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.3rem" }}>
                      <span style={{ fontWeight: 500 }}>{g.title}</span>
                      <span className="muted">{formatNumber(g.current_value)} / {formatNumber(g.target_value)} {g.unit}</span>
                    </div>
                    <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState title="Nenhuma meta ativa" />
          )}
        </Section>
      </div>
    </div>
  );
}
