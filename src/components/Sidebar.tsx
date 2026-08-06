"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle, CalendarCheck, ChevronDown, ClipboardCheck, DoorOpen, Lock,
  LayoutDashboard, LayoutGrid, Layers, NotebookPen, Settings, ShieldCheck, Headset, Users, Wrench,
  Boxes, BookMarked,
} from "lucide-react";
import { BrandLogo, BrandWordmark, BRAND_OWNER, SHOW_BRAND_OWNER } from "./BrandLogo";
import { UserMenu } from "./UserMenu";
import { NavPending } from "./ui/NavPending";
import {
  MODULE_BY_KEY, MODULE_GROUPS, NAV_ORDER, modulesInGroup,
  type GroupKey, type ModuleDef, type ModuleKey, type ModuleState,
} from "@/lib/modules";
import type { Enums } from "@/types/database";
import type { Theme } from "@/lib/theme";

const SZ = 17;

// ícones ficam no cliente; a estrutura vem do registry (src/lib/modules.ts)
const GROUP_ICONS: Record<GroupKey, React.ReactNode> = {
  g_reunioes: <CalendarCheck size={SZ} />,
  g_rotina: <NotebookPen size={SZ} />,
  g_pessoas: <Users size={SZ} />,
  g_ferramentas: <Wrench size={SZ} />,
  g_sdpo: <LayoutGrid size={SZ} />,
  g_seguranca: <ShieldCheck size={SZ} />,
};
const MODULE_ICONS: Partial<Record<ModuleKey, React.ReactNode>> = {
  dashboard: <LayoutDashboard size={SZ} />,
  chamados: <Headset size={SZ} />,
  portaria: <DoorOpen size={SZ} />,
  multas_avarias: <AlertTriangle size={SZ} />,
  cinco_s: <Boxes size={SZ} />,
  padroes: <BookMarked size={SZ} />,
  auditoria: <ClipboardCheck size={SZ} />,
  configuracoes: <Settings size={SZ} />,
  admin: <Layers size={SZ} />,
};
const GROUP_LABEL = Object.fromEntries(MODULE_GROUPS.map((g) => [g.key, g.label])) as Record<GroupKey, string>;

export function Sidebar({
  role,
  isSuperAdmin = false,
  moduleState,
  construction,
  platformOnly = false,
  userName,
  theme,
  open = false,
  onNavigate,
}: {
  role: Enums<"member_role">;
  isSuperAdmin?: boolean;
  /** estado resolvido no servidor (entitlement por unidade) */
  moduleState: Record<ModuleKey, ModuleState>;
  /** módulos marcados como "em construção" (global) */
  construction: ModuleKey[];
  /** owner de plataforma (sem empresa): mostra só o Painel ADM */
  platformOnly?: boolean;
  userName?: string | null;
  theme?: Theme;
  open?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const underWork = new Set(construction);
  // `team_lead` (Gestor) fica FORA desta lista de propósito. Gestor tem alçada da
  // própria equipe, não da empresa: nada de Logs do sistema nem de triagem de
  // chamados. Para efeito de menu ele se comporta como Funcionário; o que ele
  // enxerga a mais vem da RLS, pelo vínculo de chefia, não do papel na tela.
  const canManage = role === "owner" || role === "admin" || role === "manager";
  const canAdmin = role === "owner" || role === "admin";
  // super admin de plataforma entra na empresa já como "owner" (requireContext),
  // então não precisa de exceção aqui
  const isOwner = role === "owner";
  // "Gestor ou acima": quem tem alçada sobre uma equipe. Some do menu de quem
  // não lidera ninguém, para "Minha equipe" não virar item morto para ~880 pessoas.
  const canLeadTeam = canManage || role === "team_lead";

  /** papel primeiro (como antes), depois o entitlement da unidade. */
  const visible = (m: ModuleDef) => {
    // owner de plataforma sem empresa: só o Painel ADM
    if (platformOnly) return m.key === "admin";
    if (m.minRole === "team_lead" && !canLeadTeam) return false;
    if (m.minRole === "manager" && !canManage) return false;
    if (m.minRole === "admin" && !canAdmin) return false;
    if (m.minRole === "owner" && !isOwner) return false;
    if (m.minRole === "super" && !isSuperAdmin) return false;
    return moduleState[m.key] !== "hidden";
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const groupChildren = (g: GroupKey) => modulesInGroup(g).filter(visible);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of MODULE_GROUPS) if (groupChildren(g.key).some((c) => isActive(c.href))) init[g.key] = true;
    return init;
  });

  return (
    <aside className={`app-sidebar${open ? " app-sidebar-open" : ""}`}>
      <Link href="/dashboard" className="brand-block" onClick={onNavigate}>
        <BrandLogo size={32} radius={9} />
        <span>
          <BrandWordmark />
          {SHOW_BRAND_OWNER && <span className="brand-sub">{BRAND_OWNER}</span>}
        </span>
        <NavPending />
      </Link>

      <nav className="nav-list">
        {NAV_ORDER.map((entry) => {
          if (entry.type === "module") {
            const m = MODULE_BY_KEY[entry.key];
            if (!visible(m)) return null;
            const active = isActive(m.href);
            const locked = moduleState[m.key] === "locked";
            // cadeado ganha do capacete: mesma precedência do moduleGate
            const building = !locked && underWork.has(m.key);
            return (
              <Link
                key={m.key}
                href={m.href}
                onClick={onNavigate}
                className={`nav-item${active ? " nav-item-active" : ""}${locked || building ? " nav-locked" : ""}`}
                aria-current={active ? "page" : undefined}
                title={locked ? "Módulo não contratado" : building ? "Em construção" : undefined}
              >
                {MODULE_ICONS[m.key]}
                <span style={{ flex: 1 }}>{m.label}</span>
                {locked && <Lock size={12} aria-label="Não contratado" />}
                <NavPending />
              </Link>
            );
          }

          // grupo: só aparece se algum filho estiver visível
          const children = groupChildren(entry.key);
          if (children.length === 0) return null;
          const active = children.some((c) => isActive(c.href));
          const isOpen = openGroups[entry.key] ?? false;
          return (
            <div key={entry.key}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpenGroups((s) => ({ ...s, [entry.key]: !isOpen }))}
                className={`nav-item nav-group${active ? " nav-group-active" : ""}`}
              >
                {GROUP_ICONS[entry.key]}
                <span style={{ flex: 1, textAlign: "left" }}>{GROUP_LABEL[entry.key]}</span>
                <ChevronDown size={14} className={`nav-chevron${isOpen ? " nav-chevron-open" : ""}`} />
              </button>
              {isOpen && (
                <div className="nav-children">
                  {children.map((child) => {
                    const cActive = isActive(child.href);
                    const locked = moduleState[child.key] === "locked";
                    const building = !locked && underWork.has(child.key);
                    return (
                      <Link
                        key={child.key}
                        href={child.href}
                        onClick={onNavigate}
                        className={`nav-child${cActive ? " nav-child-active" : ""}${locked || building ? " nav-locked" : ""}`}
                        aria-current={cActive ? "page" : undefined}
                        title={locked ? "Módulo não contratado" : building ? "Em construção" : undefined}
                      >
                        <span className="nav-dot" />
                        <span style={{ flex: 1 }}>{child.label}</span>
                        {locked && <Lock size={11} aria-label="Não contratado" />}
                        <NavPending />
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {userName !== undefined && theme && (
        <div style={{ marginTop: "auto", paddingTop: "0.6rem", borderTop: "1px solid var(--mh-border)" }}>
          <UserMenu userName={userName} role={role} theme={theme} variant="sidebar" />
        </div>
      )}
    </aside>
  );
}
