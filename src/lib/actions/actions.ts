"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

const BUCKET = "action-attachments";

export type ActionPayload = {
  is_sdpo: boolean;
  pilar_id: string;
  bloco_id: string;
  item_id: string;
  meeting_series_id: string;
  occurrence_id: string;
  kpi_id: string;
  tool_id: string;
  requester_id: string;
  due_date: string;
  cc: string[];
  demandas: { description: string; assignees: string[] }[];
};

export async function createAction(formData: FormData): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await actionContext();
    const raw = String(formData.get("payload") ?? "");
    if (!raw) return { error: "Dados inválidos." };
    const payload = JSON.parse(raw) as ActionPayload;

    const demandas = (payload.demandas ?? []).filter((d) => d.description.trim());
    if (demandas.length === 0) return { error: "Informe ao menos uma demanda." };
    if (!payload.requester_id) return { error: "Informe o solicitante." };
    if (payload.is_sdpo && (!payload.pilar_id || !payload.bloco_id || !payload.item_id)) {
      return { error: "Para ações do Programa de Excelência, informe Pilar, Bloco e Item." };
    }

    const { data: result, error } = await supabase.rpc("create_action", { p_data: { ...payload, demandas } });
    if (error) return { error: error.message };
    const res = (result ?? {}) as { action_id: string; demanda_ids?: string[] };
    const actionId = res.action_id;
    const demandaIds = res.demanda_ids ?? [];

    const uploadOne = async (file: File, demandaId: string | null) => {
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${tenantId}/${actionId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (up.error) return;
      await supabase.from("action_attachments").insert({
        action_id: actionId,
        demanda_id: demandaId,
        tenant_id: tenantId,
        path,
        filename: file.name,
        size: file.size,
        content_type: file.type || null,
        uploaded_by: userId,
      });
    };

    // anexos gerais (para todas as ações)
    const headerFiles = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    for (const file of headerFiles) await uploadOne(file, null);

    // anexos por demanda/ação (alinhados à ordem das demandas)
    for (let i = 0; i < demandaIds.length; i++) {
      const dFiles = formData.getAll(`files_${i}`).filter((f): f is File => f instanceof File && f.size > 0);
      for (const file of dFiles) await uploadOne(file, demandaIds[i]);
    }

    revalidatePath("/acoes");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setDemandaStatus(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as Enums<"action_status">;
  await supabase
    .from("action_demandas")
    .update({ status, completed_at: status === "done" ? new Date().toISOString() : null })
    .eq("id", id);
  revalidatePath("/acoes");
  revalidatePath("/dashboard");
}

export async function deleteAction(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const id = String(formData.get("id"));
  // remove anexos do storage (best-effort)
  const { data: atts } = await supabase.from("action_attachments").select("path").eq("action_id", id);
  if (atts && atts.length) await supabase.storage.from(BUCKET).remove(atts.map((a) => a.path));
  await supabase.from("actions").delete().eq("id", id).eq("tenant_id", tenantId);
  revalidatePath("/acoes");
  revalidatePath("/dashboard");
}

// URL assinada para download de anexo
export async function getAttachmentUrl(path: string): Promise<string | null> {
  const { supabase } = await actionContext();
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}
