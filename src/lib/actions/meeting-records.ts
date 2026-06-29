"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { parseTor, type ParsedTor, type TextItem } from "@/lib/tor-parser";
import type { ActionState } from "./types";

const RP = "/reunioes";

export type ParseTorResult = { ok: true; data: ParsedTor } | { ok: false; error: string };

export async function parseTorPdf(formData: FormData): Promise<ParseTorResult> {
  try {
    await actionContext(); // garante sessão
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "Arquivo inválido." };
    if (file.size > 15 * 1024 * 1024) return { ok: false, error: "Arquivo muito grande (máx. 15 MB)." };

    const buf = new Uint8Array(await file.arrayBuffer());
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await getDocument({ data: buf, useSystemFonts: true, isEvalSupported: false }).promise;

    const items: TextItem[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      for (const i of tc.items) {
        const t = i as { str?: string; transform?: number[] };
        if (!t.str || !t.str.trim() || !t.transform) continue;
        items.push({ str: t.str.trim(), x: Math.round(t.transform[4]), y: Math.round(t.transform[5]) });
      }
    }
    await doc.destroy();

    if (!items.length) return { ok: false, error: "Não consegui ler texto do PDF (pode ser uma imagem escaneada)." };
    return { ok: true, data: parseTor(items) };
  } catch (e) {
    return { ok: false, error: "Falha ao processar o PDF: " + (e as Error).message };
  }
}

export type ContentRow = { item: string; tempo: string; dono: string };

export type SeriesInput = {
  id?: string;
  name: string;
  periodicity: string;
  next_date: string;
  objetivo: string;
  owner: string;
  owner_user_id: string;
  room_id: string;
  is_online: boolean;
  participants_text: string;
  duration_min: string;
  duration_unit: string;
  content: ContentRow[];
  general_rules: string[];
  how_to: string[];
  participants: string[];
  units: string[];
};

export type OccurrenceInput = {
  series_id: string;
  occurred_on: string;
  notes: string;
  decisions: string;
  advance_next: boolean;
  attendance: { user_id: string; present: boolean }[];
  actions: { title: string; assignee_id: string; due_date: string }[];
};

export async function saveSeries(input: SeriesInput): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    if (!input.name.trim()) return { error: "Informe o nome da reunião." };
    const { error } = await supabase.rpc("save_meeting_series", { p_data: input });
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function registerOccurrence(input: OccurrenceInput): Promise<ActionState & { occurrenceId?: string }> {
  try {
    const { supabase } = await actionContext();
    if (!input.series_id) return { error: "Reunião inválida." };
    const { data, error } = await supabase.rpc("register_meeting_occurrence", { p_data: input });
    if (error) return { error: error.message };
    revalidatePath(RP);
    revalidatePath("/acoes");
    revalidatePath("/dashboard");
    return { ok: true, occurrenceId: data as string };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Inicia uma reunião: cria a ocorrência em andamento (cronômetro). */
export async function startOccurrence(seriesId: string): Promise<ActionState & { occurrenceId?: string }> {
  try {
    const { supabase } = await actionContext();
    if (!seriesId) return { error: "Reunião inválida." };
    const { data, error } = await supabase.rpc("start_meeting_occurrence", { p_series_id: seriesId });
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true, occurrenceId: data as string };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type FinishOccurrenceInput = {
  occurrence_id: string;
  notes: string;
  decisions: string;
  advance_next: boolean;
  attendance: { user_id: string; present: boolean }[];
};

/** Finaliza a reunião em andamento: grava notas/decisões/presença e fecha a duração. */
export async function finishOccurrence(input: FinishOccurrenceInput): Promise<ActionState & { occurrenceId?: string }> {
  try {
    const { supabase } = await actionContext();
    if (!input.occurrence_id) return { error: "Reunião inválida." };
    const { data, error } = await supabase.rpc("finish_meeting_occurrence", { p_data: input });
    if (error) return { error: error.message };
    revalidatePath(RP);
    revalidatePath("/acoes");
    revalidatePath("/dashboard");
    return { ok: true, occurrenceId: data as string };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Cancela uma reunião em andamento (mantém no histórico). */
export async function cancelOccurrence(id: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    if (!id) return { error: "Reunião inválida." };
    const { error } = await supabase.rpc("cancel_meeting_occurrence", { p_id: id });
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function toggleSeries(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  const active = String(formData.get("is_active")) === "true";
  await supabase.from("meeting_series").update({ is_active: !active }).eq("id", id);
  revalidatePath(RP);
}

export async function deleteSeries(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("meeting_series").delete().eq("id", String(formData.get("id")));
  revalidatePath(RP);
}

export async function deleteOccurrence(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("meeting_occurrences").delete().eq("id", String(formData.get("id")));
  revalidatePath(RP);
}
