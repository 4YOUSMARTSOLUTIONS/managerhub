"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { setActiveCompany } from "@/lib/actions/scope";
import type { CompanyScope } from "@/lib/tenant";

/** Seletor de empresa do topo — só para owner de plataforma (super admin). */
export function CompanyScopeSelect({ scope }: { scope: CompanyScope }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  if (scope.companies.length === 0) return null;

  const pickCompany = (value: string) => {
    start(async () => { await setActiveCompany(value); router.refresh(); });
  };

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem" }} title="Empresa em visualização">
      <Building2 size={15} style={{ color: "var(--mh-primary-500)" }} />
      <select
        className="select"
        value={scope.activeTenantId}
        disabled={pending}
        onChange={(e) => pickCompany(e.target.value)}
        style={{ height: 34, padding: "0 1.8rem 0 0.6rem", fontSize: "0.82rem", fontWeight: 600, maxWidth: 220 }}
      >
        {scope.companies.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </label>
  );
}
