import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireContext } from "@/lib/tenant";
import { checkSuperAdmin } from "@/lib/platform";
import { getTheme } from "@/lib/theme";
import { getModuleAccess } from "@/lib/module-access";
import { AppShell } from "@/components/AppShell";
import { MODULES, type ModuleKey, type ModuleState } from "@/lib/modules";

// moduleState só-core (usado apenas no shell reduzido, quando não há empresa)
const CORE_ONLY_STATE = Object.fromEntries(
  MODULES.map((m) => [m.key, m.core ? "on" : "hidden"]),
) as Record<ModuleKey, ModuleState>;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const theme = await getTheme();
  const isSuperAdmin = await checkSuperAdmin();

  // Super admin sem NENHUMA empresa no sistema: shell reduzido, só o Painel ADM.
  if (isSuperAdmin) {
    const { data: activeId } = await supabase.rpc("my_active_tenant");
    if (!activeId) {
      return (
        <AppShell
          role="owner"
          isSuperAdmin
          tenantName="Plataforma"
          userName={user.email?.split("@")[0] ?? "Owner"}
          unitScope={{ units: [], allowedUnitIds: [], unrestricted: true, activeUnitId: null, locked: false }}
          theme={theme}
          moduleState={CORE_ONLY_STATE}
          construction={[]}
          platformOnly
        >
          {children}
        </AppShell>
      );
    }
  }

  // Fluxo normal: usuário de empresa OU super admin operando a empresa selecionada.
  const ctx = await requireContext();
  const { state: moduleState, construction } = await getModuleAccess();
  const userName = user.email?.split("@")[0] ?? "Usuário";

  return (
    <AppShell
      role={ctx.role}
      isSuperAdmin={ctx.isSuperAdmin}
      tenantName={ctx.tenant.name}
      userName={userName}
      unitScope={ctx.unitScope}
      theme={theme}
      moduleState={moduleState}
      construction={[...construction]}
      companyScope={ctx.companyScope}
    >
      {children}
    </AppShell>
  );
}
