"use client";

import { createContext, useContext } from "react";

type AvatarCtx = {
  /** user_id -> caminho da foto no bucket */
  byUser: Record<string, string>;
  currentUserId: string | null;
};

/**
 * Default vazio de propósito: o Avatar é usado fora do shell (login, onboarding) e
 * não pode explodir por falta de provider. Sem foto, ele cai nas iniciais.
 */
const Ctx = createContext<AvatarCtx>({ byUser: {}, currentUserId: null });

export const useAvatars = () => useContext(Ctx);

export function AvatarProvider({
  byUser,
  currentUserId,
  children,
}: AvatarCtx & { children: React.ReactNode }) {
  return <Ctx.Provider value={{ byUser, currentUserId }}>{children}</Ctx.Provider>;
}
