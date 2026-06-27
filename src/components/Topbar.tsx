import { signOut } from "@/lib/actions/auth";
import { Avatar } from "@/components/ui/Avatar";
import { NotificationsBell } from "@/components/NotificationsBell";
import { ROLE } from "@/lib/constants";
import type { Enums } from "@/types/database";

export function Topbar({
  tenantName,
  userName,
  role,
}: {
  tenantName: string;
  userName: string | null | undefined;
  role: Enums<"member_role">;
}) {
  return (
    <header
      style={{
        height: 60,
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 1.5rem",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      <div style={{ fontWeight: 600 }}>{tenantName}</div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
        <NotificationsBell />
        <div style={{ textAlign: "right", lineHeight: 1.2 }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>
            {userName ?? "Usuário"}
          </div>
          <div className="soft" style={{ fontSize: "0.72rem" }}>
            {ROLE[role]}
          </div>
        </div>
        <Avatar name={userName} />
        <form action={signOut}>
          <button className="btn btn-ghost btn-sm" type="submit">
            Sair
          </button>
        </form>
      </div>
    </header>
  );
}
