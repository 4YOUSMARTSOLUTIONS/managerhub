"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

async function authedClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Faça login novamente.");
  return supabase;
}

export async function createCompany(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const supabase = await authedClient();

    const company = String(formData.get("company") ?? "").trim();
    const ownerName = String(formData.get("owner_name") ?? "").trim();
    const ownerEmail = String(formData.get("owner_email") ?? "").trim();
    const ownerPassword = String(formData.get("owner_password") ?? "");

    if (!company) return { error: "Informe o nome da empresa." };
    if (!ownerName || !ownerEmail) return { error: "Informe nome e e-mail do owner." };
    if (ownerPassword.length < 8) return { error: "A senha do owner deve ter ao menos 8 caracteres." };

    const { data: tenantId, error } = await supabase.rpc("platform_create_company", {
      p_company: company,
      p_owner_email: ownerEmail,
      p_owner_password: ownerPassword,
      p_owner_name: ownerName,
    });
    if (error) return { error: error.message };

    // Define limite de unidades se informado
    const limitRaw = String(formData.get("units_limit_create") ?? "").trim();
    if (limitRaw && tenantId) {
      const limit = parseInt(limitRaw, 10);
      if (!isNaN(limit) && limit > 0) {
        await supabase.rpc("platform_set_units_limit", { p_tenant: tenantId, p_limit: limit });
      }
    }

    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setCompanyStatus(formData: FormData): Promise<void> {
  const supabase = await authedClient();
  await supabase.rpc("platform_set_company_status", {
    p_tenant: String(formData.get("tenant_id")),
    p_status: String(formData.get("status")) as Enums<"tenant_status">,
  });
  revalidatePath("/admin");
}

export async function deleteCompany(formData: FormData): Promise<void> {
  const supabase = await authedClient();
  await supabase.rpc("platform_delete_company", {
    p_tenant: String(formData.get("tenant_id")),
  });
  revalidatePath("/admin");
}

/** Cria um novo owner de plataforma (super admin) sem empresa vinculada. */
export async function createPlatformOwner(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const supabase = await authedClient();
    const name = String(formData.get("owner_name") ?? "").trim();
    const email = String(formData.get("owner_email") ?? "").trim();
    const password = String(formData.get("owner_password") ?? "");
    if (!name || !email) return { error: "Informe nome e e-mail do owner." };
    if (password.length < 8) return { error: "A senha deve ter ao menos 8 caracteres." };

    const { error } = await supabase.rpc("platform_create_owner", { p_email: email, p_password: password, p_name: name });
    if (error) return { error: error.message };
    revalidatePath("/admin/owners");
    return { ok: true, message: "Owner criado." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Promove um usuário já existente (por e-mail) a owner de plataforma. */
export async function grantPlatformAdmin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const supabase = await authedClient();
    const email = String(formData.get("email") ?? "").trim();
    if (!email) return { error: "Informe o e-mail do usuário." };
    const { error } = await supabase.rpc("platform_grant_admin", { p_email: email });
    if (error) return { error: error.message };
    revalidatePath("/admin/owners");
    return { ok: true, message: "Usuário promovido a owner." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Revoga o super admin de um owner (trava o último no banco). */
export async function revokePlatformAdmin(formData: FormData): Promise<ActionState> {
  try {
    const supabase = await authedClient();
    const { error } = await supabase.rpc("platform_revoke_admin", { p_user: String(formData.get("user_id")) });
    if (error) return { error: error.message };
    revalidatePath("/admin/owners");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setUnitsLimit(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const supabase = await authedClient();
    const tenant = String(formData.get("tenant_id"));
    const raw = String(formData.get("units_limit") ?? "").trim();
    const limit = raw === "" ? null : parseInt(raw, 10);
    if (limit !== null && (isNaN(limit) || limit < 1)) {
      return { error: "Informe um número válido (mínimo 1) ou deixe em branco para ilimitado." };
    }
    const { error } = await supabase.rpc("platform_set_units_limit", {
      p_tenant: tenant,
      p_limit: limit,
    });
    if (error) return { error: error.message };
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
