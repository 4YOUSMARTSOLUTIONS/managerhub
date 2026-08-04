import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser, getIsSuperAdmin } from "@/lib/auth-cache";

/** Garante usuário autenticado E super-admin de plataforma. */
export async function requireSuperAdmin() {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) redirect("/login");

  if (!(await getIsSuperAdmin())) redirect("/dashboard");

  return { user, supabase };
}

/** Apenas verifica (para decidir exibir o link do Painel ADM). */
export async function checkSuperAdmin(): Promise<boolean> {
  return getIsSuperAdmin();
}
