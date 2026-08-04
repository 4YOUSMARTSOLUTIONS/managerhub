"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { checarThrottle, registrarFalha, registrarSucesso, type ChaveThrottle } from "@/lib/auth-throttle";

/**
 * Verifica a senha do usuário atualmente logado SEM derrubar a sessão.
 * Usa um cliente anon efêmero (persistSession:false) para tentar o login;
 * sucesso = senha correta. Não toca nos cookies da sessão real.
 *
 * Vem com freio porque, sem ele, isto é um oráculo de senha: devolve um booleano
 * por chamada e podia ser chamado à vontade por qualquer sessão. A chave é o
 * user_id, presa à sessão — trocar de IP não ajuda, e abrir outra sessão exige
 * passar pelo login, que tem o próprio freio.
 */
export async function verifyOwnPassword(password: string): Promise<boolean> {
  if (!password) return false;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email;
  if (!email || !user) return false;

  const chaves: ChaveThrottle[] = [{ bucket: "senha_usuario", chave: user.id }];
  const portao = await checarThrottle(chaves);
  if (portao.bloqueado) return false;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;

  const ephemeral = createSupabaseClient<Database>(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await ephemeral.auth.signInWithPassword({ email, password });
  if (error) {
    await registrarFalha(chaves);
    return false;
  }
  await registrarSucesso(chaves);
  return true;
}
