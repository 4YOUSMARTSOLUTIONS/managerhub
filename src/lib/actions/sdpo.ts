"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";

const RP = "/configuracoes";

// ---------- Pilares ----------
export async function createPilar(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("sdpo_pilares").insert({ tenant_id: tenantId, name });
  revalidatePath(RP);
}
export async function deletePilar(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("sdpo_pilares").delete().eq("id", String(formData.get("id")));
  revalidatePath(RP);
}

// ---------- Blocos (pertencem a um Pilar) ----------
export async function createBloco(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const name = String(formData.get("name") ?? "").trim();
  const pilar_id = String(formData.get("pilar_id") ?? "");
  if (!name || !pilar_id) return;
  await supabase.from("sdpo_blocos").insert({ tenant_id: tenantId, pilar_id, name });
  revalidatePath(RP);
}
export async function deleteBloco(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("sdpo_blocos").delete().eq("id", String(formData.get("id")));
  revalidatePath(RP);
}

// ---------- Itens (pertencem a um Bloco) ----------
export async function createItem(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const name = String(formData.get("name") ?? "").trim();
  const bloco_id = String(formData.get("bloco_id") ?? "");
  if (!name || !bloco_id) return;
  await supabase.from("sdpo_itens").insert({ tenant_id: tenantId, bloco_id, name });
  revalidatePath(RP);
}
export async function deleteItem(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("sdpo_itens").delete().eq("id", String(formData.get("id")));
  revalidatePath(RP);
}

// ---------- KPIs ----------
export async function createKpi(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("action_kpis").insert({ tenant_id: tenantId, name });
  revalidatePath(RP);
}
export async function deleteKpi(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("action_kpis").delete().eq("id", String(formData.get("id")));
  revalidatePath(RP);
}

// ---------- Ferramentas de gestão ----------
export async function createTool(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("action_tools").insert({ tenant_id: tenantId, name });
  revalidatePath(RP);
}
export async function deleteTool(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("action_tools").delete().eq("id", String(formData.get("id")));
  revalidatePath(RP);
}
