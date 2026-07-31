import { requireSuperAdmin } from "@/lib/platform";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { UnitModulesEditor, type Matrix, type UnitRow } from "@/components/admin/UnitModulesEditor";
import { CompanyPicker } from "@/components/admin/CompanyPicker";
import { AdminTabs } from "@/components/admin/AdminTabs";
import type { ModuleKey, ModuleState } from "@/lib/modules";

export default async function AdminModulosPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  const { supabase } = await requireSuperAdmin();
  const { empresa } = await searchParams;

  const { data: companies } = await supabase.rpc("platform_companies");
  const list = (companies ?? []).map((c) => ({ id: c.id, name: c.name }));
  const tenantId = empresa && list.some((c) => c.id === empresa) ? empresa : list[0]?.id ?? null;

  const { data: rows } = tenantId
    ? await supabase.rpc("platform_module_matrix", { p_tenant: tenantId })
    : { data: [] };

  const unitsById = new Map<string, UnitRow>();
  const matrix: Matrix = {};
  for (const r of rows ?? []) {
    unitsById.set(r.unit_id, { id: r.unit_id, name: r.unit_name });
    matrix[r.unit_id] = { ...matrix[r.unit_id], [r.module_key as ModuleKey]: r.state as ModuleState };
  }
  const units = [...unitsById.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div>
      <PageHeader
        title="Módulos por unidade"
        subtitle="Defina o que cada unidade contratou. Vitrine mostra o módulo com cadeado, para gerar interesse."
        action={<CompanyPicker companies={list} current={tenantId} />}
      />
      <AdminTabs />
      {tenantId ? (
        // key: troca de empresa remonta o editor, zerando a unidade selecionada
        <UnitModulesEditor key={tenantId} tenantId={tenantId} units={units} matrix={matrix} />
      ) : (
        <EmptyState title="Nenhuma empresa cadastrada" description="Cadastre uma empresa na aba Empresas." />
      )}
    </div>
  );
}
