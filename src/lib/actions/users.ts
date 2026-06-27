"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

export async function createUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();

    const email = String(formData.get("email") ?? "").trim();
    const full_name = String(formData.get("full_name") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const role = (String(formData.get("role") ?? "member") as Enums<"member_role">);

    if (!email || !full_name) return { error: "Informe nome e e-mail." };
    if (password.length < 6) return { error: "A senha deve ter ao menos 6 caracteres." };

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
    const { supabase } = await actionContext();
    const password = String(formData.get("password") ?? "");
    if (password.length < 6) return { error: "A senha deve ter ao menos 6 caracteres." };

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

export async function setMemberActive(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const userId = String(formData.get("user_id"));
  const active = String(formData.get("active")) === "true";
  await supabase
    .from("memberships")
    .update({ is_active: active })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  revalidatePath("/configuracoes");
}

export async function removeUser(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.rpc("admin_delete_user", { p_user: String(formData.get("user_id")) });
  revalidatePath("/configuracoes");
}

export async function updateUserRole(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
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
    const { supabase, tenantId } = await actionContext();
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
