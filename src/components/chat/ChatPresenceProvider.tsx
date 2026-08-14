"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { salvarPreferencias } from "@/lib/actions/chat";
import { useChatPresence, type StatusPresenca } from "./useChatRealtime";
import type { Enums } from "@/types/database";

/**
 * A presença do chat mora no SHELL, não na tela do chat.
 *
 * Duas razões: quem está em qualquer outra tela continua aparecendo como
 * conectado (antes, sair do /chat fazia a pessoa "sumir" para os colegas), e o
 * ícone do usuário no menu mostra o próprio status em todo o sistema. É um
 * canal só para o app inteiro: a tela do chat consome ESTE contexto em vez de
 * abrir o dela.
 */
type ValorPresenca = {
  /** user_id -> status efetivo; ausente do mapa = offline */
  presencas: Record<string, StatusPresenca>;
  meuStatus: Enums<"chat_user_status">;
  /** troca o status manual e persiste em chat_settings */
  mudarStatus: (s: Enums<"chat_user_status">) => void;
  /** false quando não há canal (sem empresa ou chat não contratado) */
  ativo: boolean;
};

const Ctx = createContext<ValorPresenca>({
  presencas: {},
  meuStatus: "disponivel",
  mudarStatus: () => {},
  ativo: false,
});

export function useChatStatus() {
  return useContext(Ctx);
}

export const STATUS_ROTULO: Record<StatusPresenca, string> = {
  disponivel: "Disponível",
  ocupado: "Ocupado",
  ausente: "Ausente",
  offline: "Offline",
};

export const STATUS_COR: Record<StatusPresenca, string> = {
  disponivel: "var(--mh-success)",
  ocupado: "var(--mh-danger)",
  ausente: "var(--mh-warning)",
  offline: "var(--mh-text-3)",
};

export function ChatPresenceProvider({
  tenantId,
  meuId,
  statusInicial,
  children,
}: {
  /** null desliga a presença (super admin sem empresa, ou chat não contratado) */
  tenantId: string | null;
  meuId: string | null;
  statusInicial: Enums<"chat_user_status">;
  children: React.ReactNode;
}) {
  const [meuStatus, setMeuStatus] = useState(statusInicial);
  const presencas = useChatPresence(tenantId, meuId, meuStatus);

  const mudarStatus = useCallback((s: Enums<"chat_user_status">) => {
    setMeuStatus(s);
    void salvarPreferencias({ status: s });
  }, []);

  return (
    <Ctx.Provider value={{ presencas, meuStatus, mudarStatus, ativo: Boolean(tenantId && meuId) }}>
      {children}
    </Ctx.Provider>
  );
}
