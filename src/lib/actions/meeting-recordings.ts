"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";
import { recusaDeUpload, TAMANHO_AUDIO, MIMES_AUDIO } from "@/lib/uploads";

const BUCKET = "meeting-audio";
const RP = "/reunioes";

export type RecordingRow = {
  id: string;
  path: string;
  filename: string;
  size: number | null;
  durationSeconds: number | null;
  source: string;
  transcript: string | null;
  status: Enums<"recording_transcript_status">;
  error: string | null;
  transcribedAt: string | null;
  createdAt: string;
};

/** Sobe o áudio da gravação, cria a linha e dispara a transcrição (Edge Function, async). */
export async function uploadRecording(formData: FormData): Promise<ActionState & { recordingId?: string }> {
  try {
    const ctx = await actionContext();
    const occurrenceId = String(formData.get("occurrence_id") ?? "");
    const source = String(formData.get("source") ?? "gravacao");
    const durationRaw = Number(formData.get("duration_seconds"));
    const file = formData.get("file");
    if (!occurrenceId) return { error: "Reunião inválida." };
    if (!(file instanceof File) || file.size === 0) return { error: "Nenhum áudio para enviar." };
    const recusa = recusaDeUpload(file, TAMANHO_AUDIO, MIMES_AUDIO);
    if (recusa) return { error: recusa };

    const safe = file.name.replace(/[^\w.\-]+/g, "_") || "audio.webm";
    const path = `${ctx.tenantId}/${occurrenceId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
    const up = await ctx.supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (up.error) return { error: up.error.message };

    const { data: row, error } = await ctx.supabase.from("meeting_recordings").insert({
      tenant_id: ctx.tenantId,
      occurrence_id: occurrenceId,
      path,
      filename: file.name || safe,
      size: file.size,
      content_type: file.type || null,
      duration_seconds: Number.isFinite(durationRaw) ? Math.round(durationRaw) : null,
      source,
      uploaded_by: ctx.userId,
      transcript_status: "pendente",
    }).select("id").single();
    if (error) return { error: error.message };

    // dispara a Edge Function (retorno rápido 202; a transcrição segue em background)
    try {
      await ctx.supabase.functions.invoke("transcribe-recording", { body: { recording_id: row.id } });
    } catch (e) {
      console.error("[recording] invoke transcribe-recording falhou:", (e as Error).message);
    }

    revalidatePath(RP);
    return { ok: true, recordingId: row.id };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Reprocessa a transcrição (retry para falha/pendente/travado). */
export async function retranscribeRecording(recordingId: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!recordingId) return { error: "Gravação inválida." };
    await ctx.supabase.from("meeting_recordings").update({ transcript_status: "processando", transcript_error: null }).eq("id", recordingId);
    await ctx.supabase.functions.invoke("transcribe-recording", { body: { recording_id: recordingId } });
    revalidatePath(RP);
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Lista as gravações de uma ocorrência (RLS filtra pela privacidade da reunião). */
export async function getRecordings(occurrenceId: string): Promise<RecordingRow[]> {
  try {
    const { supabase } = await actionContext();
    if (!occurrenceId) return [];
    const { data } = await supabase.from("meeting_recordings")
      .select("id, path, filename, size, duration_seconds, source, transcript, transcript_status, transcript_error, transcribed_at, created_at")
      .eq("occurrence_id", occurrenceId)
      .order("created_at", { ascending: true });
    return (data ?? []).map((r) => ({
      id: r.id, path: r.path, filename: r.filename, size: r.size, durationSeconds: r.duration_seconds,
      source: r.source, transcript: r.transcript, status: r.transcript_status, error: r.transcript_error,
      transcribedAt: r.transcribed_at, createdAt: r.created_at,
    }));
  } catch { return []; }
}

/** URL assinada (10 min) para reproduzir o áudio. */
export async function getRecordingUrl(path: string): Promise<string | null> {
  try {
    const { supabase } = await actionContext();
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
    return data?.signedUrl ?? null;
  } catch { return null; }
}

export async function deleteRecording(id: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { data: rec } = await ctx.supabase.from("meeting_recordings").select("path").eq("id", id).maybeSingle();
    if (rec?.path) { const rm = await ctx.supabase.storage.from(BUCKET).remove([rec.path]); if (rm.error) console.error("[recording] cleanup:", rm.error.message); }
    const { error } = await ctx.supabase.from("meeting_recordings").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath(RP);
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}
