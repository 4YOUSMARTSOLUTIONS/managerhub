"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAdminView } from "@/lib/actions/scope";

/**
 * Toggle discreto (só super admin): "Como a empresa" x "Ver tudo".
 * Controla se o menu respeita os módulos da empresa ou mostra tudo.
 */
export function AdminViewToggle({ viewAll }: { viewAll: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  const set = (v: boolean) => {
    if (v === viewAll) return;
    start(async () => { await setAdminView(v); router.refresh(); });
  };

  return (
    <span
      title="Como você enxerga o menu desta empresa"
      style={{ display: "inline-flex", border: "1px solid var(--mh-border)", borderRadius: 6, overflow: "hidden", opacity: pending ? 0.6 : 1 }}
    >
      <button type="button" disabled={pending} onClick={() => set(false)} className="adm-view-btn" data-on={!viewAll}>Como a empresa</button>
      <button type="button" disabled={pending} onClick={() => set(true)} className="adm-view-btn" data-on={viewAll}>Ver tudo</button>
    </span>
  );
}
