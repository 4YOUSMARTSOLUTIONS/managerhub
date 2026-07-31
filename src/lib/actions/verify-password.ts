"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createClient } from "@/lib/supabase/server";

/**
 * Verifica a senha do usuário atualmente logado SEM derrubar a sessão.
 * Usa um cliente anon efêmero (persistSession:false) para tentar o login;
 * sucesso = senha correta. Não toca nos cookies da sessão real.
 */
export async function verifyOwnPassword(password: string): Promise<boolean> {
  if (!password) return false;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email;
  if (!email) return false;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;

  const ephemeral = createSupabaseClient<Database>(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await ephemeral.auth.signInWithPassword({ email, password });
  return !error;
}
