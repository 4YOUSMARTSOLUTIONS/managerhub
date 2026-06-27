"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { isValidCpf, onlyDigits } from "@/lib/cpf";
import type { ActionState } from "./types";

function buildData(formData: FormData, cpf: string) {
  return {
    full_name: String(formData.get("full_name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    cpf,
    phone: String(formData.get("phone") ?? "").trim(),
    birth_date: String(formData.get("birth_date") ?? ""),
    gender: String(formData.get("gender") ?? ""),
    employee_code: String(formData.get("employee_code") ?? "").trim(),
    admission_date: String(formData.get("admission_date") ?? ""),
    department_id: String(formData.get("department_id") ?? ""),
    subdepartment_id: String(formData.get("subdepartment_id") ?? ""),
    position_id: String(formData.get("position_id") ?? ""),
    position_level_id: String(formData.get("position_level_id") ?? ""),
    manager_id: String(formData.get("manager_id") ?? ""),
    role: String(formData.get("role") ?? "member"),
    unit_ids: formData.getAll("unit_ids").map(String).filter(Boolean),
  };
}

export async function createEmployee(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const cpf = onlyDigits(String(formData.get("cpf") ?? ""));
    if (!isValidCpf(cpf)) return { error: "CPF inválido. Confira os números." };
    const password = String(formData.get("password") ?? "");
    if (password.length < 6) return { error: "A senha deve ter ao menos 6 caracteres." };

    const { error } = await supabase.rpc("admin_create_employee", {
      p_data: buildData(formData, cpf),
      p_password: password,
    });
    if (error) return { error: error.message };

    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type ImportSummary = { created: number; skipped: number; errors: { nome?: string; cpf?: string; erro: string }[] };

export async function importEmployees(
  rows: Record<string, string>[],
  password: string,
): Promise<ImportSummary> {
  try {
    const { supabase } = await actionContext();
    if (!password || password.length < 6) {
      return { created: 0, skipped: 0, errors: [{ erro: "Senha padrão mínima de 6 caracteres." }] };
    }
    const { data, error } = await supabase.rpc("admin_import_employees", {
      p_rows: rows as unknown as never,
      p_password: password,
    });
    if (error) return { created: 0, skipped: 0, errors: [{ erro: error.message }] };
    revalidatePath("/configuracoes");
    return data as unknown as ImportSummary;
  } catch (e) {
    return { created: 0, skipped: 0, errors: [{ erro: (e as Error).message }] };
  }
}

export async function updateEmployee(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const userId = String(formData.get("user_id") ?? "");
    if (!userId) return { error: "Usuário inválido." };
    const cpf = onlyDigits(String(formData.get("cpf") ?? ""));
    if (!isValidCpf(cpf)) return { error: "CPF inválido. Confira os números." };

    const { error } = await supabase.rpc("admin_update_employee", {
      p_user: userId,
      p_data: buildData(formData, cpf),
    });
    if (error) return { error: error.message };

    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
