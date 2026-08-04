import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Quem está abaixo de mim no organograma.
 *
 * A regra mora no banco, em `my_managed_memberships()`, e não aqui: ela é a
 * mesma função que as policies de metas, feedbacks, PDI e checklists consultam.
 * O app precisa perguntar a ela, e não repetir a consulta por conta própria,
 * senão as duas divergem e a tela passa a mentir.
 *
 * Foi exatamente o que acontecia antes: as telas faziam
 * `.eq("manager_id", user.id)`, um nível só e sem olhar o papel. Com a visão de
 * equipe agora recursiva e travada por perfil, aquela consulta listaria os
 * filhos enquanto a RLS libera filhos E netos, e mostraria nome de gente cujos
 * dados o banco recusa a quem não é Gestor.
 */
export async function minhaEquipe(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<string[]> {
  const { data } = await supabase
    .rpc("my_managed_memberships")
    .eq("tenant_id", tenantId);
  return (data ?? []).map((r) => r.user_id);
}

/**
 * Sou gestor desta pessoa? Usado nas server actions antes de gravar.
 *
 * A RLS já barraria a escrita sozinha; esta checagem existe para o usuário
 * receber uma recusa em português em vez de um erro cru de policy. Por isso ela
 * tem de concordar com a RLS, e a única forma de garantir isso é chamar a mesma
 * função (`manages_user`, escrita sobre a de cima).
 */
export async function souGestorDe(
  supabase: SupabaseClient<Database>,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const { data } = await supabase.rpc("manages_user", {
    p_owner: userId,
    p_tenant: tenantId,
  });
  return data === true;
}
