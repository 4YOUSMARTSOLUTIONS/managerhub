import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Identidade do request, resolvida UMA vez.
 *
 * `auth.getUser()` não é uma leitura local: é uma chamada de rede ao serviço de
 * autenticação para validar o token. O app chamava três vezes por navegação (proxy,
 * layout e requireContext) e mais três em toda server action. O `cache()` do React
 * dedupe dentro do mesmo request, sem mudar nenhuma regra de acesso.
 *
 * O proxy continua com a chamada dele: é ela que renova o cookie da sessão, roda em
 * outro contexto e não pode ser dispensada.
 */
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});

/** Mesma ideia para o super admin, que era verificado duas vezes por navegação. */
export const getIsSuperAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_super_admin");
  return Boolean(data);
});

/** Nome e foto do próprio usuário: uma linha por chave primária, reusada no shell. */
export const getOwnIdentity = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();
  return data;
});
