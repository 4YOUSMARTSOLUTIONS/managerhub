import { requireSuperAdmin } from "@/lib/platform";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormModal } from "@/components/ui/FormModal";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { ConfirmActionButton } from "@/components/ui/ConfirmActionButton";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { createPlatformOwner, grantPlatformAdmin, revokePlatformAdmin } from "@/lib/actions/platform";
import { formatDate } from "@/lib/format";

export default async function AdminOwnersPage() {
  const { user, supabase } = await requireSuperAdmin();
  const { data: owners } = await supabase.rpc("platform_admins_list");
  const list = owners ?? [];

  return (
    <div>
      <PageHeader
        title="Owners da plataforma"
        subtitle="Super admins com acesso a todas as empresas do sistema. Não pertencem a nenhuma empresa."
        action={
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            <FormModal triggerLabel="+ Novo owner" title="Novo owner de plataforma" action={createPlatformOwner} submitLabel="Criar owner" width={480}>
              <div>
                <label className="label">Nome</label>
                <input name="owner_name" className="input" required placeholder="4YOU Smart Solutions" />
              </div>
              <div>
                <label className="label">E-mail</label>
                <input name="owner_email" type="email" className="input" required placeholder="contato@empresa.com" />
              </div>
              <div>
                <label className="label">Senha inicial</label>
                <PasswordInput name="owner_password" autoComplete="new-password" minLength={6} placeholder="Mínimo 6 caracteres" />
              </div>
              <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
                O owner entra direto no Painel ADM, sem empresa vinculada, e pode gerenciar todas as empresas.
              </p>
            </FormModal>
            <FormModal triggerLabel="Promover existente" triggerClassName="btn btn-ghost" title="Promover usuário a owner" action={grantPlatformAdmin} submitLabel="Promover" width={440}>
              <div>
                <label className="label">E-mail do usuário</label>
                <input name="email" type="email" className="input" required placeholder="usuario@empresa.com" />
              </div>
              <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
                O usuário precisa já existir no sistema. Ele passa a ter acesso de super admin.
              </p>
            </FormModal>
          </div>
        }
      />
      <AdminTabs />

      <Section title={`Owners · ${list.length}`} padded={false}>
        {list.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Desde</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => {
                const isSelf = o.user_id === user.id;
                const isLast = list.length <= 1;
                return (
                  <tr key={o.user_id}>
                    <td style={{ fontWeight: 600 }}>
                      {o.full_name ?? "—"}
                      {isSelf && <Badge tone="blue">Você</Badge>}
                    </td>
                    <td className="muted">{o.email}</td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatDate(o.created_at)}</td>
                    <td style={{ textAlign: "right" }}>
                      {isLast ? (
                        <span className="soft" style={{ fontSize: "0.8rem" }} title="Não é possível remover o último owner">Único owner</span>
                      ) : (
                        <ConfirmActionButton
                          action={revokePlatformAdmin}
                          fields={{ user_id: o.user_id }}
                          className="btn btn-danger btn-sm"
                          buttonTitle="Revogar super admin"
                          title="Revogar owner de plataforma"
                          message={<>Revogar o acesso de super admin de <strong>{o.full_name ?? o.email}</strong>? A conta continua existindo, mas perde o acesso a todas as empresas.</>}
                          confirmLabel="Revogar"
                        >
                          Revogar
                        </ConfirmActionButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState title="Nenhum owner" description="Cadastre o primeiro owner de plataforma." />
        )}
      </Section>
    </div>
  );
}
