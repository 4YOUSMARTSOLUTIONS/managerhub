"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { isValidCnpj, normalizeCnpj } from "@/lib/cnpj";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

const RP = "/configuracoes";

// ---------- Unidades ----------
export async function createUnit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    const name = String(formData.get("name") ?? "").trim();
    const kind = (String(formData.get("kind") ?? "filial") as Enums<"unit_kind">);
    if (!name) return { error: "Informe o nome da unidade." };
    const cnpjRaw = String(formData.get("cnpj") ?? "").trim();
    const cnpj = cnpjRaw ? (isValidCnpj(normalizeCnpj(cnpjRaw)) ? normalizeCnpj(cnpjRaw) : null) : null;
    const { error } = await supabase.from("units").insert({ tenant_id: tenantId, name, kind, ...(cnpj ? { cnpj } : {}) });
    if (error) {
      if (error.code === "P0001") return { error: error.message };
      if (error.code === "23505") return { error: "Esse CNPJ já está cadastrado em outra unidade." };
      return { error: error.message };
    }
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
export async function updateUnit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const id = String(formData.get("id"));
    const name = String(formData.get("name") ?? "").trim();
    const kind = String(formData.get("kind") ?? "") as Enums<"unit_kind">;
    if (!name) return { error: "Informe o nome da unidade." };
    const cnpjRaw = String(formData.get("cnpj") ?? "").trim();
    let cnpj: string | null = null;
    if (cnpjRaw) {
      const normalized = normalizeCnpj(cnpjRaw);
      if (!isValidCnpj(normalized)) return { error: "CNPJ inválido. Confira os dígitos." };
      cnpj = normalized;
    }
    const { error } = await supabase.from("units").update({ name, kind, cnpj }).eq("id", id);
    if (error) {
      if (error.code === "23505") return { error: "Esse CNPJ já está cadastrado em outra unidade." };
      return { error: error.message };
    }
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
export async function deleteUnit(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("units").delete().eq("id", String(formData.get("id")));
  revalidatePath(RP);
}

// ---------- Setores ----------
export async function createDepartment(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("departments").insert({ tenant_id: tenantId, name });
  revalidatePath(RP);
}
export async function deleteDepartment(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("departments").delete().eq("id", String(formData.get("id")));
  revalidatePath(RP);
}

// ---------- Subsetores ----------
export async function createSubdepartment(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const name = String(formData.get("name") ?? "").trim();
  const department_id = String(formData.get("department_id") ?? "");
  if (!name || !department_id) return;
  await supabase.from("subdepartments").insert({ tenant_id: tenantId, department_id, name });
  revalidatePath(RP);
}
export async function deleteSubdepartment(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("subdepartments").delete().eq("id", String(formData.get("id")));
  revalidatePath(RP);
}

// ---------- Funções ----------
export async function createPosition(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("positions").insert({ tenant_id: tenantId, name });
  revalidatePath(RP);
}
export async function deletePosition(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("positions").delete().eq("id", String(formData.get("id")));
  revalidatePath(RP);
}

// ---------- Perfis de função ----------
export async function createPositionLevel(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("position_levels").insert({ tenant_id: tenantId, name });
  revalidatePath(RP);
}
export async function deletePositionLevel(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("position_levels").delete().eq("id", String(formData.get("id")));
  revalidatePath(RP);
}
