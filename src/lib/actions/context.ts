import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser, getIsSuperAdmin } from "@/lib/auth-cache";
import type { Enums } from "@/types/database";

/**
 * Contexto para uso dentro de Server Actions (não redireciona, lança erro).
 * Retorna o cliente, o usuário e o tenant ativo.
 *
 * Owner de plataforma (super admin): opera na EMPRESA SELECIONADA no topo
 * (`my_active_tenant`), como papel "owner" — mesmo sem membership. Assim as
 * actions gravam/leem na empresa certa, igual ao `requireContext`.
 *
 * `cache()`: várias actions chamam isto mais de uma vez no mesmo request, e cada
 * chamada custava de 3 a 4 idas ao banco ANTES de qualquer trabalho útil. É o custo
 * que o usuário sente ao clicar em salvar.
 */
export const actionContext = cache(async function actionContext() {
  const supabase = await createClient();
  const [user, isSuper] = await Promise.all([getAuthUser(), getIsSuperAdmin()]);
  if (!user) throw new Error("Sessão expirada. Faça login novamente.");

  if (isSuper) {
    const { data: activeId } = await supabase.rpc("my_active_tenant");
    if (activeId) {
      return { supabase, userId: user.id, tenantId: activeId as string, role: "owner" as Enums<"member_role"> };
    }
  }

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
});
