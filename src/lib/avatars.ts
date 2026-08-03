import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Mapa `user_id -> caminho da foto` da empresa, carregado uma vez por request no
 * layout e distribuído por contexto.
 *
 * A alternativa seria incluir `avatar_url` nas ~10 consultas que já trazem
 * `full_name` e criar um campo paralelo em cada tipo de linha (requesterAvatar,
 * assigneeAvatar, ownerAvatar...). Seriam 30+ edições, cada uma com a chance de
 * esquecer o hint de FK abaixo. Assim é uma consulta nova e nenhuma alterada.
 */
export const getAvatarMap = cache(async (tenantId: string): Promise<Record<string, string>> => {
  const supabase = await createClient();
  // o hint !memberships_user_id_fkey é OBRIGATÓRIO: memberships tem duas FKs para
  // profiles e, sem ele, a consulta falha calada e todo mundo volta para as iniciais
  const { data } = await supabase
    .from("memberships")
    .select("user_id, profiles!memberships_user_id_fkey(avatar_url)")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);

  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    const path = (row.profiles as { avatar_url: string | null } | null)?.avatar_url;
    if (path) out[row.user_id] = path;
  }
  return out;
});
