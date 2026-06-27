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
    if (ownerPassword.length < 6) return { error: "A senha do owner deve ter ao menos 6 caracteres." };

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
