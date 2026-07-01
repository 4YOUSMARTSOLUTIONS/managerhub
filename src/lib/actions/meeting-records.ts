"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { requireContext, effectiveUnitFilter } from "@/lib/tenant";
import { parseTor, type ParsedTor, type TextItem } from "@/lib/tor-parser";
import { dispatchSeriesInvite } from "./meetings";
import type { ActionState } from "./types";
import type { OccurrenceRow } from "@/components/MeetingRecords";
import { OCC_PAGE_SIZE } from "@/lib/constants";

/** Próxima página de registros (ocorrências), para "Carregar mais" sem perder o estado da tela. */
export async function loadMoreOccurrences(offset: number): Promise<OccurrenceRow[]> {
  const { supabase, tenantId } = await actionContext();

  // respeita o escopo de unidade global (via séries linkadas às unidades)
  const { unitScope } = await requireContext();
  const scopeUnitIds = effectiveUnitFilter(unitScope);
  let scopeSeriesIds: string[] | null = null;
  if (scopeUnitIds) {
    const { data: links } = await supabase.from("meeting_series_units").select("series_id").in("unit_id", scopeUnitIds);
    scopeSeriesIds = [...new Set((links ?? []).map((l) => l.series_id))];
  }

  let q = supabase
    .from("meeting_occurrences")
    .select("id, series_id, occurred_on, status, started_at, ended_at, duration_seconds, draft, registered_by, meeting_series(name), registrant:profiles!registered_by(full_name)")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("started_at", { ascending: false, nullsFirst: false })
    .order("occurred_on", { ascending: false });
  if (scopeSeriesIds) q = q.in("series_id", scopeSeriesIds);
  const { data: occ } = await q.range(offset, offset + OCC_PAGE_SIZE - 1);

  const rows = occ ?? [];
  const occIds = rows.map((o) => o.id);
  const [{ data: att }, { data: acts }] = await Promise.all([
    occIds.length ? supabase.from("meeting_attendance").select("occurrence_id, present").in("occurrence_id", occIds) : Promise.resolve({ data: [] as { occurrence_id: string; present: boolean }[] }),
    occIds.length ? supabase.from("action_items").select("occurrence_id").in("occurrence_id", occIds) : Promise.resolve({ data: [] as { occurrence_id: string | null }[] }),
  ]);
  const attBy = new Map<string, { total: number; present: number }>();
  for (const a of att ?? []) {
    const cur = attBy.get(a.occurrence_id) ?? { total: 0, present: 0 };
    cur.total += 1;
    if (a.present) cur.present += 1;
    attBy.set(a.occurrence_id, cur);
  }
  const actBy = new Map<string, number>();
  for (const a of acts ?? []) { if (a.occurrence_id) actBy.set(a.occurrence_id, (actBy.get(a.occurrence_id) ?? 0) + 1); }

  return rows.map((o) => {
    const counts = attBy.get(o.id) ?? { total: 0, present: 0 };
    return {
      id: o.id,
      seriesId: o.series_id,
      seriesName: (o.meeting_series as { name: string } | null)?.name ?? "—",
      occurredOn: o.occurred_on,
      status: o.status,
      startedAt: o.started_at,
      endedAt: o.ended_at,
      durationSeconds: o.duration_seconds,
      draft: (o.draft as OccurrenceRow["draft"]) ?? null,
      presentCount: counts.present,
      totalCount: counts.total,
      actionsCount: actBy.get(o.id) ?? 0,
      registeredByName: (o.registrant as { full_name: string | null } | null)?.full_name ?? null,
    };
  });
}

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
  start_time: string;
  auto_book: boolean;
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
    const { data: seriesId, error } = await supabase.rpc("save_meeting_series", { p_data: input });
    if (error) return { error: error.message };

    // Auto-reserva de sala + convite recorrente (Outlook). Best-effort: não
    // bloqueia o salvamento da série se a reserva/convite falhar.
    if (seriesId) {
      try {
        await supabase.rpc("sync_series_bookings", { p_series: seriesId as string });
        await dispatchSeriesInvite(seriesId as string, input.auto_book ? "REQUEST" : "CANCEL");
      } catch (e) {
        console.error("[series] auto-reserva/convite falhou:", (e as Error).message);
      }
      revalidatePath("/salas");
    }

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

export type CollectedDraft = {
  payload: {
    is_sdpo: boolean; pilar_id: string; bloco_id: string; item_id: string;
    meeting_series_id: string; kpi_id: string; tool_id: string; requester_id: string;
    due_date: string; priority: string; cc: string[];
    demandas: { description: string; assignees: string[] }[];
  };
  summary: string;
};

export type OccurrenceDraft = {
  notes: string;
  decisions: string;
  attendees: string[];
  present: Record<string, boolean>;
  advance: boolean;
  aiDraft: string;
  aiActionsDraft?: string;
  collected: CollectedDraft[];
};

/** Autosave do rascunho da reunião em andamento (silencioso — sem revalidate). */
export async function saveOccurrenceDraft(occurrenceId: string, draft: OccurrenceDraft): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    if (!occurrenceId) return { error: "Reunião inválida." };
    const { error } = await supabase.rpc("save_occurrence_draft", { p_id: occurrenceId, p_draft: draft });
    if (error) return { error: error.message };
    return { ok: true };
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

export async function deleteSeries(formData: FormData): Promise<ActionState> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  // soft-delete: preserva histórico e não órfã as ações (FK intacta).
  // Desativa + desliga auto-reserva para limpar reservas futuras e cancelar o convite.
  const { error } = await supabase
    .from("meeting_series")
    .update({ deleted_at: new Date().toISOString(), is_active: false, auto_book: false })
    .eq("id", id);
  if (error) return { error: error.message };
  try {
    await dispatchSeriesInvite(id, "CANCEL"); // cancela a série no Outlook
    // excluir a série leva TODAS as reservas futuras junto — inclusive as
    // ocorrências movidas/canceladas manualmente (destacadas).
    await supabase.from("meetings").delete().eq("series_id", id).gte("starts_at", new Date().toISOString());
  } catch (e) {
    console.error("[series] limpeza pós-exclusão falhou:", (e as Error).message);
  }
  revalidatePath(RP);
  revalidatePath("/salas");
  return { ok: true };
}

export async function deleteOccurrence(formData: FormData): Promise<ActionState> {
  const { supabase } = await actionContext();
  // soft-delete: mantém a ação vinculada (occurrence_id) e o histórico.
  const { error } = await supabase.from("meeting_occurrences").update({ deleted_at: new Date().toISOString() }).eq("id", String(formData.get("id")));
  if (error) return { error: error.message };
  revalidatePath(RP);
  return { ok: true };
}
