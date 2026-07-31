"use client";

import { Menu } from "lucide-react";
import { NotificationsBell } from "@/components/NotificationsBell";
import { UnitScopeSelect } from "@/components/UnitScopeSelect";
import { CompanyScopeSelect } from "@/components/CompanyScopeSelect";
import { AdminViewToggle } from "@/components/AdminViewToggle";
import type { UnitScope, CompanyScope } from "@/lib/tenant";

export function Topbar({
  tenantName,
  unitScope,
  onMenu,
  platformOnly = false,
  companyScope = null,
}: {
  tenantName: string;
  unitScope: UnitScope;
  onMenu?: () => void;
  /** modo owner de plataforma (sem empresa): esconde seletor de unidade e sino */
  platformOnly?: boolean;
  /** super admin: seletor de empresa no topo */
  companyScope?: CompanyScope | null;
}) {
  return (
    <header className="app-topbar">
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
        <button type="button" className="icon-btn menu-btn" onClick={onMenu} aria-label="Abrir menu">
          <Menu size={17} />
        </button>
        <div
          style={{
            fontWeight: 600,
            letterSpacing: "-0.01em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {tenantName}
        </div>
        {companyScope && <AdminViewToggle viewAll={companyScope.viewAll} />}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
        {companyScope && <CompanyScopeSelect scope={companyScope} />}
        {!platformOnly && <UnitScopeSelect scope={unitScope} />}
        {!platformOnly && <NotificationsBell />}
      </div>
    </header>
  );
}
