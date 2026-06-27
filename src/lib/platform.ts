import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Garante usuário autenticado E super-admin de plataforma. */
export async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuper } = await supabase.rpc("is_super_admin");
  if (!isSuper) redirect("/dashboard");

  return { user, supabase };
}

/** Apenas verifica (para decidir exibir o link do Painel ADM). */
export async function checkSuperAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_super_admin");
  return Boolean(data);
}
