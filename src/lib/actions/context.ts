import { createClient } from "@/lib/supabase/server";

/**
 * Contexto para uso dentro de Server Actions (não redireciona, lança erro).
 * Retorna o cliente, o usuário e o tenant ativo (primeira membership).
 */
export async function actionContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Faça login novamente.");

  const { data } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);

  const membership = data?.[0];
  if (!membership) throw new Error("Nenhuma empresa associada.");

  return {
    supabase,
    userId: user.id,
    tenantId: membership.tenant_id,
    role: membership.role,
  };
}
