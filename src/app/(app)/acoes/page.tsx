import { requireContext, getMembers } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormModal } from "@/components/ui/FormModal";
import { InlineStatus } from "@/components/ui/InlineStatus";
import { createAction, setActionStatus, deleteAction } from "@/lib/actions/actions";
import {
  ACTION_STATUS,
  ACTION_STATUS_TONE,
  PRIORITY,
  PRIORITY_TONE,
  options,
} from "@/lib/constants";
import { formatDate, isOverdue } from "@/lib/format";

export default async function ActionsPage() {
  const { tenant } = await requireContext();
  const supabase = await createClient();

  const [{ data: actions }, members, { data: meetings }] = await Promise.all([
    supabase
      .from("action_items")
      .select("*, assignee:profiles!assignee_id(full_name), meetings(title)")
      .order("status")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(200),
    getMembers(tenant.id),
    supabase.from("meetings").select("id, title").order("starts_at", { ascending: false }).limit(50),
  ]);

  return (
    <div>
      <PageHeader
        title="Ações"
        subtitle="Itens de ação abertos nas reuniões — com prazo e responsável."
        action={
          <FormModal triggerLabel="+ Nova ação" title="Nova ação" action={createAction} submitLabel="Criar ação">
            <div>
              <label className="label">Título</label>
              <input name="title" className="input" required placeholder="Enviar proposta ao cliente" />
            </div>
            <div>
              <label className="label">Descrição</label>
              <textarea name="description" className="textarea" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
              <div>
                <label className="label">Responsável</label>
                <select name="assignee_id" className="select">
                  <option value="">Ninguém</option>
                  {members.map((m) => (
                    <option key={m.profile?.id} value={m.profile?.id}>{m.profile?.full_name ?? m.profile?.email}</option>
                  ))}
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
                <label className="label">Prazo</label>
                <input name="due_date" type="date" className="input" />
              </div>
              <div>
                <label className="label">Reunião de origem</label>
                <select name="meeting_id" className="select">
                  <option value="">Nenhuma</option>
                  {meetings?.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                </select>
              </div>
            </div>
          </FormModal>
        }
      />

      <Section title={`${actions?.length ?? 0} ação(ões)`} padded={false}>
        {actions && actions.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Ação</th>
                <th>Responsável</th>
                <th>Prioridade</th>
                <th>Prazo</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => {
                const assignee = a.assignee;
                const meeting = a.meetings;
                return (
                  <tr key={a.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{a.title}</div>
                      {meeting && <div className="soft" style={{ fontSize: "0.75rem" }}>de: {meeting.title}</div>}
                    </td>
                    <td>
                      {assignee ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
                          <Avatar name={assignee.full_name} />
                          <span className="muted" style={{ fontSize: "0.85rem" }}>{assignee.full_name}</span>
                        </span>
                      ) : <span className="soft">—</span>}
                    </td>
                    <td><Badge tone={PRIORITY_TONE[a.priority]}>{PRIORITY[a.priority]}</Badge></td>
                    <td style={{ color: a.status !== "done" && isOverdue(a.due_date) ? "#dc2626" : "var(--text-muted)", whiteSpace: "nowrap" }}>
                      {formatDate(a.due_date)}
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <Badge tone={ACTION_STATUS_TONE[a.status]}>{ACTION_STATUS[a.status]}</Badge>
                        <InlineStatus id={a.id} value={a.status} options={options(ACTION_STATUS)} action={setActionStatus} />
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <form action={deleteAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <button className="btn btn-danger btn-sm" type="submit">Excluir</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState title="Nenhuma ação" description="Crie ações para acompanhar as pendências das reuniões." />
        )}
      </Section>
    </div>
  );
}
