"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavPending } from "@/components/ui/NavPending";

/**
 * Abas do Painel ADM como sub-rotas: cada aba só executa a própria consulta
 * (a primitiva `Tabs` recebe o conteúdo de todas de uma vez).
 */
const TABS = [
  { href: "/admin", label: "Empresas" },
  { href: "/admin/modulos", label: "Módulos por unidade" },
  { href: "/admin/construcao", label: "Em construção" },
  { href: "/admin/interesses", label: "Interesses" },
  { href: "/admin/integracoes", label: "Integrações" },
  { href: "/admin/owners", label: "Owners" },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <div className="tabbar">
      {TABS.map((t) => {
        const active = t.href === "/admin" ? pathname === "/admin" : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={`tab${active ? " tab-active" : ""}`} aria-current={active ? "page" : undefined}>
            {t.label}
            <NavPending stripe={false} />
          </Link>
        );
      })}
    </div>
  );
}
