import { requireSuperAdmin } from "@/lib/platform";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { ConstructionToggle } from "@/components/admin/ConstructionToggle";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { MODULE_GROUPS, SELLABLE_MODULES, modulesInGroup, type ModuleKey } from "@/lib/modules";

export default async function AdminConstrucaoPage() {
  const { supabase } = await requireSuperAdmin();

  const { data: flags } = await supabase
    .from("platform_module_flags")
    .select("module_key, under_construction")
    .eq("under_construction", true);
  const under = new Set((flags ?? []).map((f) => f.module_key as ModuleKey));

  const groups: { title: string; mods: typeof SELLABLE_MODULES }[] = [
    ...MODULE_GROUPS.map((g) => ({ title: g.label, mods: modulesInGroup(g.key).filter((m) => !m.core) })),
    { title: "Módulos avulsos", mods: SELLABLE_MODULES.filter((m) => m.group === null) },
  ].filter((g) => g.mods.length > 0);

  return (
    <div>
      <PageHeader
        title="Em construção"
        subtitle="Vale para todas as empresas. Mesmo liberada, a página mostra apenas o aviso e nada do conteúdo carrega."
      />
      <AdminTabs />
      <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
        {groups.map((g) => (
          <Section key={g.title} title={g.title}>
            <div className="mod-rows">
              {g.mods.map((m) => (
                <div key={m.key} className="mod-row">
                  <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{m.label}</span>
                  <ConstructionToggle moduleKey={m.key} moduleLabel={m.label} under={under.has(m.key)} />
                </div>
              ))}
            </div>
          </Section>
        ))}
      </div>
    </div>
  );
}
