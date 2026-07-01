import { requireContext } from "@/lib/tenant";
import { checkSuperAdmin } from "@/lib/platform";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { tenant, user, role, unitScope } = await requireContext();
  const isSuperAdmin = await checkSuperAdmin();

  // nome do usuário a partir do perfil
  const userName = user.email?.split("@")[0] ?? "Usuário";

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar role={role} isSuperAdmin={isSuperAdmin} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar tenantName={tenant.name} userName={userName} role={role} unitScope={unitScope} />
        <main style={{ padding: "1.75rem", flex: 1 }}>{children}</main>
      </div>
    </div>
  );
}
