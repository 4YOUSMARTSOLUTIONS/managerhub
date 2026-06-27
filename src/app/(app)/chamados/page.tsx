import { requireContext, getMembers } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormModal } from "@/components/ui/FormModal";
import { InlineStatus } from "@/components/ui/InlineStatus";
import { createTicket, setTicketStatus, deleteTicket } from "@/lib/actions/tickets";
import {
  TICKET_STATUS,
  TICKET_STATUS_TONE,
  TICKET_CATEGORY,
  PRIORITY,
  PRIORITY_TONE,
  options,
} from "@/lib/constants";
import { formatDate, isOverdue } from "@/lib/format";

export default async function TicketsPage() {
  const { tenant } = await requireContext();
  const supabase = await createClient();

  const [{ data: tickets }, members] = await Promise.all([
    supabase
      .from("tickets")
      .select("*, assignee:profiles!assignee_id(full_name)")
      .order("created_at", { ascending: false })
      .limit(200),
    getMembers(tenant.id),
  ]);

  return (
    <div>
      <PageHeader
        title="Chamados"
        subtitle="Solicitações de TI, Serviços Gerais e outras áreas."
        action={
          <FormModal triggerLabel="+ Abrir chamado" title="Abrir chamado" action={createTicket} submitLabel="Abrir chamado">
            <div>
              <label className="label">Título</label>
              <input name="title" className="input" required placeholder="Computador não liga" />
            </div>
            <div>
              <label className="label">Descrição</label>
              <textarea name="description" className="textarea" placeholder="Detalhe o problema ou solicitação" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
              <div>
                <label className="label">Categoria</label>
                <select name="category" className="select" defaultValue="ti">
                  {options(TICKET_CATEGORY).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Prioridade</label>
                <select name="priority" className="select" defaultValue="medium">
                  {options(PRIORITY).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
              <div>
                <label className="label">Responsável</label>
                <select name="assignee_id" className="select">
                  <option value="">A definir</option>
                  {members.map((m) => (
                    <option key={m.profile?.id} value={m.profile?.id}>{m.profile?.full_name ?? m.profile?.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Prazo (SLA)</label>
                <input name="due_date" type="date" className="input" />
              </div>
            </div>
          </FormModal>
        }
      />

      <Section title={`${tickets?.length ?? 0} chamado(s)`} padded={false}>
        {tickets && tickets.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Chamado</th>
                <th>Categoria</th>
                <th>Prioridade</th>
                <th>Responsável</th>
                <th>Prazo</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => {
                const assignee = t.assignee;
                const openish = !["resolved", "closed", "cancelled"].includes(t.status);
                return (
                  <tr key={t.id}>
                    <td className="soft" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{t.code}</td>
                    <td style={{ fontWeight: 600 }}>{t.title}</td>
                    <td><Badge tone="purple">{TICKET_CATEGORY[t.category]}</Badge></td>
                    <td><Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY[t.priority]}</Badge></td>
                    <td>
                      {assignee ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
                          <Avatar name={assignee.full_name} />
                          <span className="muted" style={{ fontSize: "0.85rem" }}>{assignee.full_name}</span>
                        </span>
                      ) : <span className="soft">—</span>}
                    </td>
                    <td style={{ color: openish && isOverdue(t.due_date) ? "#dc2626" : "var(--text-muted)", whiteSpace: "nowrap" }}>{formatDate(t.due_date)}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <Badge tone={TICKET_STATUS_TONE[t.status]}>{TICKET_STATUS[t.status]}</Badge>
                        <InlineStatus id={t.id} value={t.status} options={options(TICKET_STATUS)} action={setTicketStatus} />
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <form action={deleteTicket}>
                        <input type="hidden" name="id" value={t.id} />
                        <button className="btn btn-danger btn-sm" type="submit">Excluir</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState title="Nenhum chamado" description="Abra o primeiro chamado de TI ou Serviços Gerais." />
        )}
      </Section>
    </div>
  );
}
