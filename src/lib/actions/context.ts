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
    .select("tenant_id, role, is_active, tenants(status)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);

  const membership = data?.[0];
  if (!membership) throw new Error("Nenhuma empresa associada.");

  // O requireContext das PÁGINAS já recusava usuário desativado e empresa
  // suspensa, mas as server actions não: um funcionário desligado continuava
  // gravando até o token dele expirar, porque o proxy valida a assinatura do JWT
  // localmente e não sabe do desligamento.
  if (membership.is_active === false) {
    throw new Error("Seu acesso foi desativado. Procure a administração.");
  }
  const status = (membership.tenants as unknown as { status: string } | null)?.status;
  if (status && status !== "active") {
    throw new Error("O acesso da empresa está suspenso.");
  }

  return {
    supabase,
    userId: user.id,
    tenantId: membership.tenant_id,
    role: membership.role,
  };
});

/**
 * Mesmo contexto, com uma trava: só passa owner ou admin.
 *
 * Existe desde que o Gerencial passou a ENTRAR em /configuracoes. A RLS já
 * recusa a escrita dele em todas aquelas tabelas, mas recusa em silêncio: um
 * `update` que não casa com a policy afeta zero linha e volta sem erro, e as
 * actions de catálogo não olham o retorno. O usuário clicaria em "Excluir" e
 * veria a tela recarregar com o item intacto, sem entender o motivo.
 *
 * Aqui a recusa vira erro com nome. E é a segunda camada que o AGENTS.md pede:
 * a guarda no corpo não confia só no grant, porque um afrouxamento futuro de
 * policy não pode virar edição sem que ninguém perceba.
 */
export async function adminActionContext() {
  const ctx = await actionContext();
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    throw new Error("Apenas proprietário e administrador podem alterar as configurações.");
  }
  return ctx;
}

/**
 * A mesma trava, um degrau mais larga: passa também o RH.
 *
 * Vale só no departamento pessoal (cadastro de colaborador, férias e
 * afastamentos, punições e remuneração variável). Todo o resto de
 * /configuracoes continua no `adminActionContext`, e a divisão precisa ser feita
 * action por action: trocar uma pela outra por engano é o tipo de erro que a RLS
 * não denuncia, porque lá o RH também está autorizado nessas tabelas.
 *
 * O que esta função NÃO cobre, de propósito: `setUserPassword` e `removeUser`.
 * E a troca de perfil de acesso é barrada no banco, pelo trigger
 * `memberships_rh_nao_define_papel`, não aqui.
 */
export async function dpActionContext() {
  const ctx = await actionContext();
  if (ctx.role !== "owner" && ctx.role !== "admin" && ctx.role !== "hr") {
    throw new Error("Apenas proprietário, administrador e RH podem alterar o departamento pessoal.");
  }
  return ctx;
}
