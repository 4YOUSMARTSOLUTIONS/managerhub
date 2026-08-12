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
export type AuthUser = {
  id: string;
  email: string | null;
  /**
   * Senha ainda é a que a administração cadastrou.
   *
   * `null` quer dizer "o token não carrega essa informação", que é diferente de
   * `false`. Quem precisa de certeza (o layout) chama `trocaDeSenhaPendente`;
   * quem só quer a resposta barata (as server actions) trata `null` como
   * desconhecido e vai ao banco só nesse caso.
   */
  trocaPendente: boolean | null;
};

/** Lê a pendência de troca de dentro do JWT, sem ida ao banco. */
function pendenciaDaClaim(appMetadata: unknown): boolean | null {
  if (!appMetadata || typeof appMetadata !== "object") return null;
  return (appMetadata as { must_change_password?: boolean }).must_change_password === true;
}

export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createClient();
  // getClaims valida a assinatura localmente (o projeto assina com ES256 e publica o
  // JWKS); o getUser faria uma ida à rede ao servidor de autenticação a cada request
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (sub) {
    return {
      id: sub,
      email: (data.claims.email as string | undefined) ?? null,
      trocaPendente: pendenciaDaClaim(data.claims.app_metadata),
    };
  }

  // mesma rede de segurança do middleware: se a validação local não reconheceu,
  // confirma no servidor antes de tratar como deslogado
  const { data: { user } } = await supabase.auth.getUser();
  return user
    ? { id: user.id, email: user.email ?? null, trocaPendente: pendenciaDaClaim(user.app_metadata) }
    : null;
});

/**
 * Pendência de troca de senha, versão AUTORITATIVA.
 *
 * A claim do token é uma cópia com validade de um TTL: depois de um reset por
 * administrador, o token que o usuário já tem na mão continua limpo por até uma
 * hora. Esta leitura fecha essa janela na navegação seguinte, e é a que o layout
 * usa. Não recebe parâmetro: a RPC responde só por `auth.uid()`.
 */
export const trocaDeSenhaPendente = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("minha_troca_pendente");
  return Boolean(data);
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
