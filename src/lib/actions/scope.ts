"use server";

import { cookies } from "next/headers";
import { requireContext, UNIT_COOKIE } from "@/lib/tenant";

/** Define o escopo de unidade global (cookie). value = unitId ou "all". */
export async function setUnitScope(value: string): Promise<void> {
  const { unitScope } = await requireContext();
  if (unitScope.locked) return; // acesso a 1 unidade só — não alterna

  const ok = value === "all" || unitScope.allowedUnitIds.includes(value);
  if (!ok) return;

  const cookieStore = await cookies();
  cookieStore.set(UNIT_COOKIE, value, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
