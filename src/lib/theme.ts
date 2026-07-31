import { cookies } from "next/headers";

export const THEME_COOKIE = "mh_theme";
export type Theme = "light" | "dark";

/** Tema padrão do produto. Só muda se o usuário escolher outro no toggle. */
export const DEFAULT_THEME: Theme = "dark";

/** Tema ativo, lido no servidor — evita flash de tema errado (FOUC). */
export async function getTheme(): Promise<Theme> {
  const cookieStore = await cookies();
  return cookieStore.get(THEME_COOKIE)?.value === "light" ? "light" : DEFAULT_THEME;
}
