import { requireSuperAdmin } from "@/lib/platform";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { formatDateTime } from "@/lib/format";
import { MODULE_BY_KEY, type ModuleKey } from "@/lib/modules";

export default async function AdminInteressesPage() {
  const { supabase } = await requireSuperAdmin();
  const { data: rows } = await supabase.rpc("platform_module_interest");
  const list = rows ?? [];

  return (
    <div>
      <PageHeader
        title="Interesses"
        subtitle="Cliques em 'Tenho interesse' na vitrine, por empresa, unidade e módulo."
      />
      <AdminTabs />
      <Section title={`Demanda · ${list.length}`} padded={false}>
        {list.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Módulo</th>
                <th>Empresa</th>
                <th>Unidade</th>
                <th style={{ textAlign: "right" }}>Pessoas</th>
                <th style={{ textAlign: "right" }}>Cliques</th>
                <th>Último</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={`${r.tenant_id}-${r.unit_id}-${r.module_key}`}>
                  <td style={{ fontWeight: 600 }}>
                    {MODULE_BY_KEY[r.module_key as ModuleKey]?.label ?? r.module_key}
                  </td>
                  <td className="muted">{r.tenant_name}</td>
                  <td className="muted">{r.unit_name}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.users_count}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{r.hits}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatDateTime(r.last_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            title="Nenhum interesse registrado"
            description="Quando um usuário clicar em 'Tenho interesse' num módulo em vitrine, a demanda aparece aqui."
          />
        )}
      </Section>
    </div>
  );
}
