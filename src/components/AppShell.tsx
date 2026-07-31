"use client";

import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { EscToClose } from "@/components/EscToClose";
import type { Enums } from "@/types/database";
import type { UnitScope, CompanyScope } from "@/lib/tenant";
import type { Theme } from "@/lib/theme";
import type { ModuleKey, ModuleState } from "@/lib/modules";

export function AppShell({
  role,
  isSuperAdmin,
  tenantName,
  userName,
  unitScope,
  theme,
  moduleState,
  construction,
  platformOnly = false,
  companyScope = null,
  children,
}: {
  role: Enums<"member_role">;
  isSuperAdmin: boolean;
  tenantName: string;
  userName: string | null | undefined;
  unitScope: UnitScope;
  theme: Theme;
  moduleState: Record<ModuleKey, ModuleState>;
  /** array, não Set: Set não serializa do servidor para o cliente */
  construction: ModuleKey[];
  /** owner de plataforma sem empresa: shell reduzido (só Painel ADM) */
  platformOnly?: boolean;
  /** super admin: seletor de empresa no topo */
  companyScope?: CompanyScope | null;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="app-root">
      <EscToClose />
      <Sidebar
        role={role}
        isSuperAdmin={isSuperAdmin}
        moduleState={moduleState}
        construction={construction}
        platformOnly={platformOnly}
        userName={userName}
        theme={theme}
        open={menuOpen}
        onNavigate={() => setMenuOpen(false)}
      />
      {menuOpen && <div className="app-scrim" onClick={() => setMenuOpen(false)} aria-hidden />}
      <div className="app-main">
        <Topbar
          tenantName={tenantName}
          unitScope={unitScope}
          onMenu={() => setMenuOpen(true)}
          platformOnly={platformOnly}
          companyScope={companyScope}
        />
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
