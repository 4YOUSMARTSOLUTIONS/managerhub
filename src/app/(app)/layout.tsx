import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireContext } from "@/lib/tenant";
import { checkSuperAdmin } from "@/lib/platform";
import { getTheme } from "@/lib/theme";
import { getModuleAccess } from "@/lib/module-access";
import { getAvatarMap } from "@/lib/avatars";
import { getAuthUser, getOwnIdentity } from "@/lib/auth-cache";
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
  // 1º estágio: identidade, tema e papel de plataforma, tudo junto. Antes eram três
  // esperas em fila, e o getUser/is_super_admin ainda se repetiam dentro do
  // requireContext logo abaixo (agora compartilhados por auth-cache).
  const [user, theme, isSuperAdmin] = await Promise.all([
    getAuthUser(),
    getTheme(),
    checkSuperAdmin(),
  ]);
  if (!user) redirect("/login");

  // Super admin sem NENHUMA empresa no sistema: shell reduzido, só o Painel ADM.
  if (isSuperAdmin) {
    // createClient só lê cookies, não vai à rede; fica no ramo que precisa dele
    const supabase = await createClient();
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
          currentUserId={user.id}
        >
          {children}
        </AppShell>
      );
    }
  }

  // 2º estágio: o contexto da empresa, do qual o resto depende.
  const ctx = await requireContext();

  // 3º estágio: o que depende só do tenant/usuário, tudo junto.
  const [{ state: moduleState, construction }, avatars, perfil] = await Promise.all([
    getModuleAccess(),
    getAvatarMap(ctx.tenant.id),
    getOwnIdentity(user.id),
  ]);

  // o nome real vem do cadastro; o prefixo do e-mail é só a reserva de quem ainda
  // não tem full_name (e rende uma inicial só: "luiz.nobre" vira "l")
  const userName = perfil?.full_name?.trim() || user.email?.split("@")[0] || "Usuário";

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
      avatars={avatars}
      currentUserId={user.id}
    >
      {children}
    </AppShell>
  );
}
