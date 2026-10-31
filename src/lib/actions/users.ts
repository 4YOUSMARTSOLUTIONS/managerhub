"use server";

import { revalidatePath } from "next/cache";
import { adminActionContext, dpActionContext } from "./context";
import { createServiceClient } from "@/lib/supabase/admin";
import { dispararRecuperacao } from "@/lib/reset-senha";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

export async function createUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase } = await adminActionContext();

    const email = String(formData.get("email") ?? "").trim();
    const full_name = String(formData.get("full_name") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const role = (String(formData.get("role") ?? "member") as Enums<"member_role">);

    if (!email || !full_name) return { error: "Informe nome e e-mail." };
    if (password.length < 8) return { error: "A senha deve ter ao menos 8 caracteres." };

    const { error } = await supabase.rpc("admin_create_user", {
      p_email: email,
      p_password: password,
      p_full_name: full_name,
      p_role: role,
    });
    if (error) return { error: error.message };

    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setUserPassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase } = await adminActionContext();
    const password = String(formData.get("password") ?? "");
    if (password.length < 8) return { error: "A senha deve ter ao menos 8 caracteres." };

    const { error } = await supabase.rpc("admin_set_password", {
      p_user: String(formData.get("user_id")),
      p_password: password,
    });
    if (error) return { error: error.message };

    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Manda para o colaborador o mesmo link que a tela de acesso enviaria.
 *
 * Serve o atendimento por telefone: em vez de o RH inventar uma senha, dizê-la
 * em voz alta e a pessoa ter de trocá-la depois, ela recebe o link e escolhe a
 * própria senha.
 *
 * `dpActionContext`, e não `adminActionContext` como a vizinha `setUserPassword`:
 * disparar o link não dá acesso a quem dispara — a mensagem vai para o e-mail do
 * cadastro, que só o dono lê. Definir a senha à mão é outra coisa, e continua
 * fora do alcance do RH.
 *
 * A resposta diz quando não há e-mail, e aqui isso é correto: quem está do outro
 * lado é o departamento pessoal olhando a ficha, não um anônimo na tela de
 * acesso. É informação que ele já vê no cadastro.
 */
export async function enviarLinkDeRecuperacao(formData: FormData): Promise<ActionState> {
  try {
    await dpActionContext();
    const userId = String(formData.get("user_id") ?? "");
    if (!userId) return { error: "Colaborador não informado." };

    const admin = createServiceClient();
    const { data: identificador } = await admin.rpc("identificador_de_recuperacao", {
      p_user: userId,
    });
    if (!identificador) {
      return { error: "Este colaborador não tem e-mail cadastrado. Cadastre o e-mail na ficha ou redefina a senha por aqui." };
    }

    const { data } = await admin.rpc("destino_de_recuperacao", { p_identificador: identificador });
    const destino = (data as { destino?: string | null } | null)?.destino ?? null;
    if (!destino) {
      return { error: "Este colaborador não tem e-mail cadastrado. Cadastre o e-mail na ficha ou redefina a senha por aqui." };
    }

    await dispararRecuperacao(identificador);
    return { ok: true, message: "Link de recuperação enviado para o e-mail do colaborador." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Ativar e inativar colaborador é departamento pessoal, então o RH também faz.
 *
 * As vizinhas continuam em `adminActionContext` de propósito: `setUserPassword`
 * e `removeUser` são as duas coisas que ele expressamente não pode, e
 * `updateUserRole` é barrada no banco pelo trigger `memberships_rh_nao_define_papel`
 * mesmo que alguém a chame direto.
 */
export async function setMemberActive(formData: FormData): Promise<{ error?: string }> {
  try {
    const { supabase, tenantId } = await dpActionContext();
    const userId = String(formData.get("user_id"));
    const active = String(formData.get("active")) === "true";
    const { error } = await supabase
      .from("memberships")
      .update({ is_active: active })
      .eq("tenant_id", tenantId)
      .eq("user_id", userId);
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    return {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function removeUser(formData: FormData): Promise<{ error?: string }> {
  try {
    const { supabase } = await adminActionContext();
    const { error } = await supabase.rpc("admin_delete_user", { p_user: String(formData.get("user_id")) });
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    return {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updateUserRole(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await adminActionContext();
  const userId = String(formData.get("id"));
  const role = String(formData.get("role")) as Enums<"member_role">;
  await supabase
    .from("memberships")
    .update({ role })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  revalidatePath("/configuracoes");
}

export async function updateCompany(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { error: "Informe o nome da empresa." };

    const { error } = await supabase.from("tenants").update({ name }).eq("id", tenantId);
    if (error) return { error: error.message };

    revalidatePath("/configuracoes");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
