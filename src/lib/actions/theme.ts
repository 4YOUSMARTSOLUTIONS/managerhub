"use server";

import { cookies } from "next/headers";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

/** Define o tema (cookie). Lido no root layout para evitar FOUC. */
export async function setTheme(value: Theme): Promise<void> {
  if (value !== "light" && value !== "dark") return;
  const cookieStore = await cookies();
  cookieStore.set(THEME_COOKIE, value, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
