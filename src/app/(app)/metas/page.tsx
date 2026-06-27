import { requireContext, getMembers } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormModal } from "@/components/ui/FormModal";
import { InlineStatus } from "@/components/ui/InlineStatus";
import { createGoal, addGoalUpdate, setGoalStatus, deleteGoal } from "@/lib/actions/goals";
import { GOAL_STATUS, GOAL_STATUS_TONE, options } from "@/lib/constants";
import { formatDate, formatNumber } from "@/lib/format";

export default async function GoalsPage() {
  const { tenant } = await requireContext();
  const supabase = await createClient();

  const [{ data: goals }, members] = await Promise.all([
    supabase
      .from("goals")
      .select("*, owner:profiles!owner_id(full_name)")
      .order("created_at", { ascending: false }),
    getMembers(tenant.id),
  ]);

  return (
    <div>
      <PageHeader
        title="Metas do time"
        subtitle="Defina e acompanhe os objetivos e indicadores do time."
        action={
          <FormModal triggerLabel="+ Nova meta" title="Nova meta" action={createGoal} submitLabel="Criar meta">
            <div>
              <label className="label">Título</label>
              <input name="title" className="input" required placeholder="Faturamento do trimestre" />
            </div>
            <div>
              <label className="label">Descrição</label>
              <textarea name="description" className="textarea" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.8rem" }}>
              <div>
                <label className="label">Valor atual</label>
                <input name="current_value" type="number" step="any" className="input" defaultValue={0} />
              </div>
              <div>
                <label className="label">Meta (alvo)</label>
                <input name="target_value" type="number" step="any" className="input" required placeholder="100" />
              </div>
              <div>
                <label className="label">Unidade</label>
                <input name="unit" className="input" placeholder="R$, %, un" />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
              <div>
                <label className="label">Início</label>
                <input name="period_start" type="date" className="input" />
              </div>
              <div>
                <label className="label">Fim</label>
                <input name="period_end" type="date" className="input" />
              </div>
            </div>
            <div>
              <label className="label">Responsável</label>
              <select name="owner_id" className="select">
                <option value="">Time</option>
                {members.map((m) => (
                  <option key={m.profile?.id} value={m.profile?.id}>{m.profile?.full_name ?? m.profile?.email}</option>
                ))}
              </select>
            </div>
          </FormModal>
        }
      />

      {goals && goals.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
            gap: "1.25rem",
          }}
        >
          {goals.map((g) => {
            const owner = g.owner;
            const pct = g.target_value > 0 ? Math.min(100, Math.round((g.current_value / g.target_value) * 100)) : 0;
            return (
              <div key={g.id} className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{g.title}</div>
                    {g.description && <div className="muted" style={{ fontSize: "0.82rem", marginTop: "0.2rem" }}>{g.description}</div>}
                  </div>
                  <Badge tone={GOAL_STATUS_TONE[g.status]}>{GOAL_STATUS[g.status]}</Badge>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.35rem" }}>
                    <span className="muted">Progresso</span>
                    <span style={{ fontWeight: 600 }}>
                      {formatNumber(g.current_value)} / {formatNumber(g.target_value)} {g.unit} <span className="soft">({pct}%)</span>
                    </span>
                  </div>
                  <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8rem" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }} className="muted">
                    <Avatar name={owner?.full_name ?? "Time"} /> {owner?.full_name ?? "Time"}
                  </span>
                  <span className="soft">{formatDate(g.period_start)} – {formatDate(g.period_end)}</span>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: "0.8rem" }}>
                  <FormModal triggerLabel="Registrar progresso" triggerClassName="btn btn-ghost btn-sm" title={`Progresso · ${g.title}`} action={addGoalUpdate} submitLabel="Salvar">
                    <input type="hidden" name="goal_id" value={g.id} />
                    <div>
                      <label className="label">Novo valor atual ({g.unit || "un"})</label>
                      <input name="value" type="number" step="any" className="input" required defaultValue={g.current_value} />
                    </div>
                    <div>
                      <label className="label">Observação</label>
                      <input name="note" className="input" placeholder="Opcional" />
                    </div>
                  </FormModal>
                  <InlineStatus id={g.id} value={g.status} options={options(GOAL_STATUS)} action={setGoalStatus} />
                  <form action={deleteGoal} style={{ marginLeft: "auto" }}>
                    <input type="hidden" name="id" value={g.id} />
                    <button className="btn btn-danger btn-sm" type="submit">Excluir</button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="Nenhuma meta" description="Crie a primeira meta do time para começar a acompanhar." />
      )}
    </div>
  );
}
