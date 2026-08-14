"use client";

import { Suspense, useState } from "react";
import { SkeletonPage } from "@/components/ui/Skeleton";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { EscToClose } from "@/components/EscToClose";
import { AvatarProvider } from "@/components/AvatarProvider";
import { ChatPresenceProvider } from "@/components/chat/ChatPresenceProvider";
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
  avatars = {},
  currentUserId = null,
  chatTenantId = null,
  chatStatus = "disponivel",
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
  /** user_id -> caminho da foto, carregado uma vez por request no layout */
  avatars?: Record<string, string>;
  currentUserId?: string | null;
  /**
   * Empresa do canal de presença do chat, ou null para não abrir canal (sem
   * empresa, ou chat não contratado). É o tenantId chegando ao cliente, e
   * continua sendo só nome de tópico, como na tela do chat.
   */
  chatTenantId?: string | null;
  chatStatus?: Enums<"chat_user_status">;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <AvatarProvider byUser={avatars} currentUserId={currentUserId}>
    <ChatPresenceProvider tenantId={chatTenantId} meuId={currentUserId} statusInicial={chatStatus}>
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
        <main className="app-content">
          {/*
            Fronteira de carregamento no LAYOUT, não em `loading.tsx`, e a
            diferença é o que o usuário vê ao trocar de tela.

            `loading.tsx` é uma fronteira de rota: o Next troca o conteúdo pelo
            esqueleto assim que se clica, sempre. Dá o cinza em toda navegação,
            inclusive nas que levam 150 ms.

            Um `<Suspense>` comum se comporta pela regra do React: navegação do
            router é uma transição, e transição NÃO derruba conteúdo que já está
            na tela para mostrar fallback. Então a tela anterior fica de pé até a
            nova estar pronta, que é o que Notion, Linear e GitHub fazem. Quem
            avisa que algo está em curso é o item do menu aceso e a barra do topo
            (NavPending), não um cinza no meio da tela.

            O esqueleto continua existindo para o único caso em que ele é a
            resposta certa: a carga fria (F5, link direto, primeiro acesso depois
            do login). Aí não há tela anterior para preservar, e sem esta
            fronteira o navegador ficaria em branco até o servidor terminar tudo,
            porque sem Suspense o React não descarrega nada antes da árvore
            inteira resolver.
          */}
          <Suspense fallback={<SkeletonPage />}>{children}</Suspense>
        </main>
      </div>
    </div>
    </ChatPresenceProvider>
    </AvatarProvider>
  );
}
