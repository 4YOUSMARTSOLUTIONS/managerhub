"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLogo } from "./BrandLogo";
import type { Enums } from "@/types/database";

type Item = { href: string; label: string; icon: React.ReactNode };

const icon = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split("|").map((p, i) => (
      <path key={i} d={p} />
    ))}
  </svg>
);

const NAV: Item[] = [
  { href: "/dashboard", label: "Dashboard", icon: icon("M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 9h8V3h-8z") },
  { href: "/reunioes", label: "Reuniões", icon: icon("M9 11l3 3 8-8|M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9") },
  { href: "/salas", label: "Salas de reuniões", icon: icon("M8 2v4|M16 2v4|M3 10h18|M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z") },
  { href: "/acoes", label: "Ações", icon: icon("M9 11l3 3L22 4|M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11") },
  { href: "/chamados", label: "Chamados", icon: icon("M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z") },
  { href: "/metas", label: "Metas", icon: icon("M12 2a10 10 0 1 0 10 10|M12 6a6 6 0 1 0 6 6|M12 10a2 2 0 1 0 2 2") },
];

const MANAGER_NAV: Item[] = [
  { href: "/auditoria", label: "Auditoria", icon: icon("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6|M9 15l2 2 4-4") },
];

const ADMIN_NAV: Item[] = [
  { href: "/configuracoes", label: "Configurações", icon: icon("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z") },
];

const SUPER_NAV: Item[] = [
  { href: "/admin", label: "Painel ADM", icon: icon("M12 2 2 7l10 5 10-5-10-5z|M2 17l10 5 10-5|M2 12l10 5 10-5") },
];

export function Sidebar({
  role,
  isSuperAdmin = false,
}: {
  role: Enums<"member_role">;
  isSuperAdmin?: boolean;
}) {
  const pathname = usePathname();
  const canManage = role === "owner" || role === "admin" || role === "manager";
  const canAdmin = role === "owner" || role === "admin";
  const items = [
    ...NAV,
    ...(canManage ? MANAGER_NAV : []),
    ...(canAdmin ? ADMIN_NAV : []),
    ...(isSuperAdmin ? SUPER_NAV : []),
  ];

  return (
    <aside
      style={{
        width: 240,
        flexShrink: 0,
        borderRight: "1px solid var(--border)",
        background: "var(--surface)",
        height: "100vh",
        position: "sticky",
        top: 0,
        display: "flex",
        flexDirection: "column",
        padding: "1.1rem 0.85rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.55rem",
          fontWeight: 800,
          fontSize: "1.05rem",
          padding: "0 0.5rem 1.1rem",
          letterSpacing: "-0.02em",
        }}
      >
        <BrandLogo size={28} radius={7} />
        MANAGER HUB
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.7rem",
                padding: "0.55rem 0.65rem",
                borderRadius: 9,
                fontSize: "0.9rem",
                fontWeight: 500,
                color: active ? "var(--primary)" : "var(--text-muted)",
                background: active ? "var(--primary-soft)" : "transparent",
              }}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
