"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setUnitScope } from "@/lib/actions/scope";
import type { UnitScope } from "@/lib/tenant";

export function UnitScopeSelect({ scope }: { scope: UnitScope }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  if (scope.units.length === 0) return null; // sem unidades cadastradas

  // acesso a 1 unidade só → chip estático (travado)
  if (scope.locked) {
    return (
      <span
        title="Você tem acesso a apenas esta unidade"
        style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem", fontWeight: 600, color: "var(--text-muted)", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.3rem 0.6rem" }}
      >
        <UnitIcon />
        {scope.units[0].name}
      </span>
    );
  }

  const onChange = (value: string) => {
    start(async () => {
      await setUnitScope(value);
      router.refresh();
    });
  };

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem" }} title="Filtrar por unidade">
      <UnitIcon />
      <select
        className="select"
        value={scope.activeUnitId ?? "all"}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        style={{ height: 34, padding: "0 1.8rem 0 0.6rem", fontSize: "0.82rem", fontWeight: 600 }}
      >
        <option value="all">Todas as unidades</option>
        {scope.units.map((u) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
    </label>
  );
}

function UnitIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}>
      <path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" />
      <path d="M9 9v.01" /><path d="M9 12v.01" /><path d="M9 15v.01" /><path d="M9 18v.01" />
    </svg>
  );
}
