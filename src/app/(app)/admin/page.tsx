import { requireSuperAdmin } from "@/lib/platform";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Section } from "@/components/ui/Section";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormModal } from "@/components/ui/FormModal";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { createCompany, setCompanyStatus, deleteCompany, setUnitsLimit } from "@/lib/actions/platform";
import { TENANT_STATUS, TENANT_STATUS_TONE } from "@/lib/constants";
import { formatDate } from "@/lib/format";

type Stats = {
  companies_total: number;
  companies_active: number;
  companies_suspended: number;
  companies_inactive: number;
  users_total: number;
  users_distinct: number;
};

const ICO = {
  limit:      "M4 21v-7|M4 10V3|M12 21v-9|M12 8V3|M20 21v-5|M20 12V3|M1 14h6|M9 8h6|M17 16h6",
  suspend:    "M10 9v6|M14 9v6|M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z",
  reactivate: "M1 4v6h6|M23 20v-6h-6|M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15",
  deactivate: "M18.36 6.64a9 9 0 1 1-12.73 0|M12 2v10",
  trash:      "M3 6h18|M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6|M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2|M10 11v6|M14 11v6",
};

function Ico({ d }: { d: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p.trim()} />)}
    </svg>
  );
}

function StatusBtn({
  id, status, iconKey, tip, tone,
}: {
  id: string;
  status: "active" | "suspended" | "inactive";
  iconKey: keyof typeof ICO;
  tip: string;
  tone?: "amber" | "green";
}) {
  return (
    <form action={setCompanyStatus} style={{ display: "inline-flex" }}>
      <input type="hidden" name="tenant_id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button
        className={`icon-btn${tone ? ` icon-btn-${tone}` : ""}`}
        type="submit"
        title={tip}
      >
        <Ico d={ICO[iconKey]} />
      </button>
    </form>
  );
}

function UnitsCell({ count, limit }: { count: number; limit: number | null }) {
  const atLimit = limit !== null && count >= limit;
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      <span style={{ fontWeight: 600, color: atLimit ? "#dc2626" : "inherit" }}>{count}</span>
      <span className="soft"> / {limit !== null ? limit : "∞"}</span>
    </span>
  );
}

export default async function AdminPage() {
  const { supabase } = await requireSuperAdmin();

  const [{ data: statsRaw }, { data: companies }] = await Promise.all([
    supabase.rpc("platform_stats"),
    supabase.rpc("platform_companies"),
  ]);

  const s = (statsRaw ?? {}) as Stats;

  return (
    <div>
      <PageHeader
        title="Painel de Administração"
        subtitle="Gestão das empresas e usuários da plataforma."
        action={
          <FormModal
            triggerLabel="+ Nova empresa"
            title="Cadastrar empresa"
            action={createCompany}
            submitLabel="Cadastrar empresa"
            width={560}
          >
            <div>
              <label className="label">Nome da empresa</label>
              <input name="company" className="input" required placeholder="Cliente XPTO Ltda" />
            </div>
            <div>
              <label className="label">Limite de unidades (opcional)</label>
              <input name="units_limit_create" type="number" min={1} className="input" placeholder="Deixe em branco para ilimitado" />
              <p className="soft" style={{ fontSize: "0.78rem", margin: "0.25rem 0 0" }}>
                Máximo de unidades (matriz/filiais) que a empresa pode cadastrar.
              </p>
            </div>
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.9rem" }}>
              <p className="muted" style={{ margin: "0 0 0.6rem", fontSize: "0.82rem", fontWeight: 600 }}>
                Usuário owner (primeiro acesso da empresa)
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                <div>
                  <label className="label">Nome do owner</label>
                  <input name="owner_name" className="input" required placeholder="Maria Gestora" />
                </div>
                <div>
                  <label className="label">E-mail do owner</label>
                  <input name="owner_email" type="email" className="input" required placeholder="maria@clientexpto.com" />
                </div>
                <div>
                  <label className="label">Senha inicial</label>
                  <PasswordInput name="owner_password" autoComplete="new-password" minLength={6} placeholder="Mínimo 6 caracteres" />
                </div>
              </div>
            </div>
          </FormModal>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <StatCard label="Empresas"    value={s.companies_total    ?? 0} tone="blue" />
        <StatCard label="Ativas"      value={s.companies_active   ?? 0} tone="green" />
        <StatCard label="Suspensas"   value={s.companies_suspended ?? 0} tone={s.companies_suspended ? "amber" : "gray"} />
        <StatCard label="Desativadas" value={s.companies_inactive  ?? 0} tone={s.companies_inactive  ? "red"   : "gray"} />
        <StatCard label="Usuários ativos" value={s.users_distinct ?? 0} hint={`${s.users_total ?? 0} vínculos`} tone="purple" />
      </div>

      <Section title={`Empresas · ${companies?.length ?? 0}`} padded={false}>
        {companies && companies.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Usuários</th>
                <th>Unidades</th>
                <th>Criada em</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => {
                const isActive    = c.status === "active";
                const isSuspended = c.status === "suspended";
                const isInactive  = c.status === "inactive";
                return (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td className="muted">{c.members_count}</td>
                    <td><UnitsCell count={c.units_count} limit={c.units_limit} /></td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatDate(c.created_at)}</td>
                    <td><Badge tone={TENANT_STATUS_TONE[c.status]}>{TENANT_STATUS[c.status]}</Badge></td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "0.3rem", justifyContent: "flex-end" }}>

                        {/* Definir limite de unidades */}
                        <FormModal
                          triggerLabel={<Ico d={ICO.limit} />}
                          triggerClassName="icon-btn"
                          title={`Limite de unidades · ${c.name}`}
                          action={setUnitsLimit}
                          submitLabel="Salvar"
                          width={400}
                        >
                          <input type="hidden" name="tenant_id" value={c.id} />
                          <div>
                            <label className="label">Máximo de unidades</label>
                            <input
                              name="units_limit"
                              type="number"
                              min={1}
                              className="input"
                              defaultValue={c.units_limit ?? ""}
                              placeholder="Deixe em branco para ilimitado"
                            />
                            <p className="soft" style={{ fontSize: "0.78rem", margin: "0.35rem 0 0" }}>
                              A empresa tem <strong>{c.units_count}</strong> unidade{c.units_count !== 1 ? "s" : ""} cadastrada{c.units_count !== 1 ? "s" : ""}.
                              Deixe em branco para remover o limite.
                            </p>
                          </div>
                        </FormModal>

                        {/* Reativar */}
                        {!isActive && (
                          <StatusBtn id={c.id} status="active" iconKey="reactivate" tip="Reativar" tone="green" />
                        )}
                        {/* Suspender */}
                        {!isSuspended && !isInactive && (
                          <StatusBtn id={c.id} status="suspended" iconKey="suspend" tip="Suspender" tone="amber" />
                        )}
                        {/* Desativar */}
                        {!isInactive && (
                          <StatusBtn id={c.id} status="inactive" iconKey="deactivate" tip="Desativar" />
                        )}
                        {/* Excluir */}
                        <form action={deleteCompany} style={{ display: "inline-flex" }}>
                          <input type="hidden" name="tenant_id" value={c.id} />
                          <button className="icon-btn icon-btn-danger" type="submit" title="Excluir empresa">
                            <Ico d={ICO.trash} />
                          </button>
                        </form>

                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState title="Nenhuma empresa cadastrada" description="Cadastre a primeira empresa cliente da plataforma." />
        )}
      </Section>
    </div>
  );
}
