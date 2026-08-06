"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { requireContext, effectiveUnitFilter } from "@/lib/tenant";
import { parseTor, type ParsedTor, type TextItem } from "@/lib/tor-parser";
import { parseTorRows } from "@/lib/tor-excel";
import { dispatchSeriesInvite } from "@/lib/invites";
import type { ActionState } from "./types";
import type { OccurrenceRow } from "@/components/MeetingRecords";
import { OCC_PAGE_SIZE } from "@/lib/constants";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "@/types/database";
import type { DemandaInfo } from "@/components/DemandaPanel";

/**
 * Quem pode editar/excluir a série (o criador NÃO edita):
 * - dono (owner_user_id), papel `owner` e papel `manager` (gerencial) sempre;
 * - reunião PÚBLICA: também `admin`;
 * - reunião PRIVADA: também os participantes.
 */
async function canEditSeries(supabase: SupabaseClient<Database>, userId: string, role: string, seriesId: string): Promise<boolean> {
  if (role === "owner" || role === "manager") return true;
  const { data } = await supabase.from("meeting_series").select("owner_user_id, is_private").eq("id", seriesId).maybeSingle();
  if (!data) return false;
  if (data.owner_user_id === userId) return true;
  if (!data.is_private) return role === "admin";
  const { data: part } = await supabase.from("meeting_series_participants")
    .select("user_id").eq("series_id", seriesId).eq("user_id", userId).maybeSingle();
  return !!part;
}

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
    .select("id, series_id, occurred_on, status, started_at, ended_at, duration_seconds, auto_finished, meeting_link, draft, registered_by, meeting_series(name), registrant:profiles!registered_by(full_name)")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("started_at", { ascending: false, nullsFirst: false })
    .order("occurred_on", { ascending: false });
  if (scopeSeriesIds) q = q.in("series_id", scopeSeriesIds);
  const { data: occ } = await q.range(offset, offset + OCC_PAGE_SIZE - 1);

  const rows = occ ?? [];
  const occIds = rows.map((o) => o.id);
  const [{ data: att }, { data: acts }, { data: recs }] = await Promise.all([
    occIds.length ? supabase.from("meeting_attendance").select("occurrence_id, present").in("occurrence_id", occIds) : Promise.resolve({ data: [] as { occurrence_id: string; present: boolean }[] }),
    occIds.length ? supabase.from("action_items").select("occurrence_id").in("occurrence_id", occIds) : Promise.resolve({ data: [] as { occurrence_id: string | null }[] }),
    occIds.length ? supabase.from("meeting_recordings").select("occurrence_id").in("occurrence_id", occIds) : Promise.resolve({ data: [] as { occurrence_id: string }[] }),
  ]);
  const recBy = new Map<string, number>();
  for (const r of recs ?? []) recBy.set(r.occurrence_id, (recBy.get(r.occurrence_id) ?? 0) + 1);
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
      autoFinished: o.auto_finished ?? false,
      meetingLink: o.meeting_link ?? null,
      startedAt: o.started_at,
      endedAt: o.ended_at,
      durationSeconds: o.duration_seconds,
      draft: (o.draft as OccurrenceRow["draft"]) ?? null,
      presentCount: counts.present,
      totalCount: counts.total,
      actionsCount: actBy.get(o.id) ?? 0,
      recordingsCount: recBy.get(o.id) ?? 0,
      registeredById: o.registered_by ?? null,
      registeredByName: (o.registrant as { full_name: string | null } | null)?.full_name ?? null,
    };
  });
}

const RP = "/reunioes";

// ---------- Detalhamento da reunião finalizada ----------
export type OccurrenceActionRow = {
  id: string;
  code: number | null;
  isSdpo: boolean;
  priority: Enums<"priority_level">;
  requesterName: string | null;
  dueDate: string | null;
  demandas: { id: string; description: string; status: Enums<"action_status">; assigneeNames: string[] }[];
};
export type OccurrenceDetail = {
  seriesName: string;
  occurredOn: string;
  status: Enums<"meeting_occurrence_status">;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  autoFinished: boolean;
  roomName: string | null;
  meetingLink: string | null;
  registeredByName: string | null;
  notes: string | null;
  decisions: string | null;
  transcript: string | null;
  attendance: { name: string; present: boolean }[];
  actions: OccurrenceActionRow[];
};

/** Detalhe completo de uma ocorrência (anotações, decisões, transcrição, presença e ações). RLS filtra o acesso. */
export async function getOccurrenceDetail(occurrenceId: string): Promise<OccurrenceDetail | null> {
  try {
    const { supabase } = await actionContext();
    if (!occurrenceId) return null;

    const { data: occ } = await supabase
      .from("meeting_occurrences")
      .select("occurred_on, status, started_at, ended_at, duration_seconds, auto_finished, meeting_link, notes, decisions, transcript, registered_by, meeting_series(name), room:rooms(name)")
      .eq("id", occurrenceId)
      .maybeSingle();
    if (!occ) return null;

    const [{ data: att }, { data: acts }] = await Promise.all([
      supabase.from("meeting_attendance").select("user_id, present").eq("occurrence_id", occurrenceId),
      supabase.from("actions").select("id, code, is_sdpo, priority, due_date, requester_id").eq("occurrence_id", occurrenceId).order("code", { ascending: true }),
    ]);

    const actionIds = (acts ?? []).map((a) => a.id);
    const { data: dems } = actionIds.length
      ? await supabase.from("action_demandas").select("id, action_id, description, status").in("action_id", actionIds)
      : { data: [] as { id: string; action_id: string; description: string; status: Enums<"action_status"> }[] };
    const demIds = (dems ?? []).map((d) => d.id);
    const { data: asg } = demIds.length
      ? await supabase.from("action_demanda_assignees").select("demanda_id, user_id").in("demanda_id", demIds)
      : { data: [] as { demanda_id: string; user_id: string }[] };

    // resolve nomes de todos os usuários envolvidos numa única consulta
    const uids = new Set<string>();
    for (const a of att ?? []) uids.add(a.user_id);
    for (const a of acts ?? []) if (a.requester_id) uids.add(a.requester_id);
    for (const a of asg ?? []) uids.add(a.user_id);
    if (occ.registered_by) uids.add(occ.registered_by);
    const { data: profs } = uids.size
      ? await supabase.from("profiles").select("id, full_name").in("id", [...uids])
      : { data: [] as { id: string; full_name: string | null }[] };
    const nameById = new Map((profs ?? []).map((p) => [p.id, p.full_name ?? "—"]));

    const asgByDemanda = new Map<string, string[]>();
    for (const a of asg ?? []) {
      const arr = asgByDemanda.get(a.demanda_id) ?? [];
      arr.push(nameById.get(a.user_id) ?? "—");
      asgByDemanda.set(a.demanda_id, arr);
    }
    const demsByAction = new Map<string, OccurrenceActionRow["demandas"]>();
    for (const d of dems ?? []) {
      const arr = demsByAction.get(d.action_id) ?? [];
      arr.push({ id: d.id, description: d.description, status: d.status, assigneeNames: asgByDemanda.get(d.id) ?? [] });
      demsByAction.set(d.action_id, arr);
    }

    return {
      seriesName: (occ.meeting_series as { name: string } | null)?.name ?? "—",
      occurredOn: occ.occurred_on,
      status: occ.status,
      startedAt: occ.started_at,
      endedAt: occ.ended_at,
      durationSeconds: occ.duration_seconds,
      autoFinished: occ.auto_finished ?? false,
      roomName: (occ.room as { name: string } | null)?.name ?? null,
      meetingLink: occ.meeting_link,
      registeredByName: occ.registered_by ? (nameById.get(occ.registered_by) ?? null) : null,
      notes: occ.notes,
      decisions: occ.decisions,
      transcript: occ.transcript,
      attendance: (att ?? []).map((a) => ({ name: nameById.get(a.user_id) ?? "—", present: a.present })),
      actions: (acts ?? []).map((a) => ({
        id: a.id,
        code: a.code,
        isSdpo: a.is_sdpo,
        priority: a.priority,
        requesterName: a.requester_id ? (nameById.get(a.requester_id) ?? null) : null,
        dueDate: a.due_date,
        demandas: demsByAction.get(a.id) ?? [],
      })),
    };
  } catch {
    return null;
  }
}

// ---------- Follow da reunião ----------

/** Uma pendência do follow, já no formato que o DemandaPanel consome + metadados do follow. */
export type FollowDemanda = {
  demanda: DemandaInfo;
  requesterId: string | null;
  code: number | null;
  overdue: boolean;
  pendingReqCount: number;
};
export type FollowDoneRow = {
  code: number | null;
  description: string;
  assigneeNames: string[];
  completedAt: string | null;
};
export type MeetingFollow = {
  pending: FollowDemanda[];
  doneSince: FollowDoneRow[];
  previousDate: string | null;
};

/**
 * Resumo do "follow" de uma reunião recorrente: pendências em aberto de
 * acontecimentos ANTERIORES da mesma série (para cobrança) e o que foi concluído
 * desde a reunião anterior. Só leitura; RLS filtra o tenant. As pendências já
 * vêm no shape do DemandaPanel para permitir tratar cada uma sem sair da tela.
 */
export async function getMeetingFollow(seriesId: string, currentOccurrenceId: string): Promise<MeetingFollow> {
  const { supabase } = await actionContext();
  const empty: MeetingFollow = { pending: [], doneSince: [], previousDate: null };
  if (!seriesId) return empty;

  // corte de "concluídas desde a última": a ocorrência finalizada anterior (ou 30 dias atrás)
  const { data: prevOcc } = await supabase
    .from("meeting_occurrences")
    .select("occurred_on")
    .eq("series_id", seriesId)
    .eq("status", "finished")
    .neq("id", currentOccurrenceId)
    .order("occurred_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  const previousDate = prevOcc?.occurred_on ?? null;
  const cutoff = previousDate ?? new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);

  const OPEN: Enums<"action_status">[] = ["open", "in_progress", "blocked"];

  // Quais ações o painel de fato mostra: as que têm demanda aberta ou concluída depois
  // do corte. Vai por RPC porque a RLS avalia can_view_action POR LINHA, e numa série
  // grande (a RLP tem 985 ações) isso custava ~3000 execuções da função, 2,6 s. A RPC
  // resolve a mesma visibilidade em conjunto, uma vez: ~200 ms.
  const { data: relevantesRaw, error: errRelevantes } = await supabase
    .rpc("meeting_follow_action_ids", { p_series: seriesId, p_occurrence: currentOccurrenceId, p_cutoff: cutoff });
  if (errRelevantes) console.error("[getMeetingFollow] ids relevantes", errRelevantes);

  const relevantes = relevantesRaw ?? [];
  if (!relevantes.length) return { ...empty, previousDate };

  // o recorte (série, ocorrência atual, demandas relevantes) já veio da RPC
  const { data: acts, error: errActs } = await supabase
    .from("actions")
    .select("id, code, is_sdpo, priority, due_date, requester_id, problem_statement, occurrence_id, pilar_id, secao_id, bloco_id, item_id, kpi_id, tool_id, meeting_series_id")
    .in("id", relevantes)
    .order("code", { ascending: true });
  if (errActs) console.error("[getMeetingFollow] ações", errActs);
  const actions = acts ?? [];
  const actionIds = actions.map((a) => a.id);
  if (!actionIds.length) return { ...empty, previousDate };

  // todas as demandas dessas ações, inclusive as antigas: o rótulo "#123.2" depende da
  // posição da demanda entre as irmãs da mesma ação
  const { data: dems, error: errDems } = await supabase
    .from("action_demandas")
    .select("id, action_id, description, status, due_date, completed_at")
    .in("action_id", actionIds);
  if (errDems) console.error("[getMeetingFollow] demandas", errDems);
  const demandas = dems ?? [];
  const demandaIds = demandas.map((d) => d.id);

  const [{ data: asg }, { data: ccs }, { data: atts }, { data: reqs }, catalog] = await Promise.all([
    demandaIds.length ? supabase.from("action_demanda_assignees").select("demanda_id, user_id, done_requested_at, completed_at").in("demanda_id", demandaIds) : Promise.resolve({ data: [] as { demanda_id: string; user_id: string; done_requested_at: string | null; completed_at: string | null }[] }),
    supabase.from("action_cc").select("action_id, user_id").in("action_id", actionIds),
    supabase.from("action_attachments").select("id, action_id, demanda_id, filename, path").in("action_id", actionIds),
    demandaIds.length ? supabase.from("demanda_requests").select("demanda_id").eq("status", "pending").in("demanda_id", demandaIds) : Promise.resolve({ data: [] as { demanda_id: string }[] }),
    loadFollowCatalog(supabase, seriesId, actions),
  ]);

  // nomes de todos os usuários envolvidos
  const uids = new Set<string>();
  for (const a of actions) if (a.requester_id) uids.add(a.requester_id);
  for (const r of asg ?? []) uids.add(r.user_id);
  for (const c of ccs ?? []) uids.add(c.user_id);
  const { data: profs } = uids.size
    ? await supabase.from("profiles").select("id, full_name").in("id", [...uids])
    : { data: [] as { id: string; full_name: string | null }[] };
  const nameById = new Map((profs ?? []).map((p) => [p.id, p.full_name ?? "—"]));

  const asgNames = new Map<string, string[]>();
  const asgIds = new Map<string, string[]>();
  const asgStates = new Map<string, { id: string; name: string; doneRequestedAt: string | null; completedAt: string | null }[]>();
  for (const r of asg ?? []) {
    (asgNames.get(r.demanda_id) ?? asgNames.set(r.demanda_id, []).get(r.demanda_id)!).push(nameById.get(r.user_id) ?? "—");
    (asgIds.get(r.demanda_id) ?? asgIds.set(r.demanda_id, []).get(r.demanda_id)!).push(r.user_id);
    (asgStates.get(r.demanda_id) ?? asgStates.set(r.demanda_id, []).get(r.demanda_id)!).push({ id: r.user_id, name: nameById.get(r.user_id) ?? "—", doneRequestedAt: r.done_requested_at, completedAt: r.completed_at });
  }
  const ccByAction = new Map<string, string[]>();
  for (const c of ccs ?? []) (ccByAction.get(c.action_id) ?? ccByAction.set(c.action_id, []).get(c.action_id)!).push(nameById.get(c.user_id) ?? "—");
  const attByDemanda = new Map<string, { id: string; filename: string; path: string }[]>();
  for (const a of atts ?? []) {
    if (!a.demanda_id) continue;
    (attByDemanda.get(a.demanda_id) ?? attByDemanda.set(a.demanda_id, []).get(a.demanda_id)!).push({ id: a.id, filename: a.filename, path: a.path });
  }
  const pendingReq = new Map<string, number>();
  for (const r of reqs ?? []) pendingReq.set(r.demanda_id, (pendingReq.get(r.demanda_id) ?? 0) + 1);

  const actById = new Map(actions.map((a) => [a.id, a]));
  const demsByAction = new Map<string, typeof demandas>();
  for (const d of demandas) (demsByAction.get(d.action_id) ?? demsByAction.set(d.action_id, []).get(d.action_id)!).push(d);

  const pending: FollowDemanda[] = [];
  const doneSince: FollowDoneRow[] = [];

  for (const d of demandas) {
    const a = actById.get(d.action_id);
    if (!a) continue;
    const total = demsByAction.get(d.action_id)?.length ?? 1;
    const idx = (demsByAction.get(d.action_id) ?? []).indexOf(d);
    const assigneeNames = asgNames.get(d.id) ?? [];

    if (OPEN.includes(d.status)) {
      const overdue = isOverduePlain(d.due_date);
      pending.push({
        demanda: {
          id: d.id,
          label: total > 1 ? `#${a.code}.${idx + 1}` : `#${a.code}`,
          description: d.description,
          status: d.status,
          dueDate: d.due_date,
          priority: a.priority,
          assigneeIds: asgIds.get(d.id) ?? [],
          assigneeNames,
          assigneeStates: asgStates.get(d.id) ?? [],
          attachments: attByDemanda.get(d.id) ?? [],
          requesterName: a.requester_id ? (nameById.get(a.requester_id) ?? null) : null,
          problem: a.problem_statement,
          ccNames: ccByAction.get(a.id) ?? [],
          isSdpo: a.is_sdpo,
          pilarName: a.pilar_id ? catalog.pilar.get(a.pilar_id) ?? null : null,
          secaoName: a.secao_id ? catalog.secao.get(a.secao_id) ?? null : null,
          blocoName: a.bloco_id ? catalog.bloco.get(a.bloco_id) ?? null : null,
          itemName: a.item_id ? catalog.item.get(a.item_id) ?? null : null,
          kpiName: a.kpi_id ? catalog.kpi.get(a.kpi_id) ?? null : null,
          toolName: a.tool_id ? catalog.tool.get(a.tool_id) ?? null : null,
          seriesName: catalog.seriesName,
          occurredOn: a.occurrence_id ? catalog.occDate.get(a.occurrence_id) ?? null : null,
        },
        requesterId: a.requester_id,
        code: a.code,
        overdue,
        // aguardando decisão = pedidos de prazo pendentes + partes de responsáveis enviadas p/ aprovação
        pendingReqCount: (pendingReq.get(d.id) ?? 0)
          + (asgStates.get(d.id) ?? []).filter((s) => s.doneRequestedAt && !s.completedAt).length,
      });
    } else if (d.status === "done" && d.completed_at && d.completed_at.slice(0, 10) >= cutoff) {
      doneSince.push({ code: a.code, description: d.description, assigneeNames, completedAt: d.completed_at });
    }
  }

  // atrasadas primeiro; depois por prazo mais próximo; sem prazo por último
  pending.sort((x, y) => {
    if (x.overdue !== y.overdue) return x.overdue ? -1 : 1;
    const dx = x.demanda.dueDate ?? "9999-12-31";
    const dy = y.demanda.dueDate ?? "9999-12-31";
    return dx.localeCompare(dy);
  });
  doneSince.sort((x, y) => (y.completedAt ?? "").localeCompare(x.completedAt ?? ""));

  return { pending, doneSince, previousDate };
}

/** Atraso puro (sem depender de helper de UI): due_date < hoje. */
function isOverduePlain(due: string | null): boolean {
  if (!due) return false;
  return due.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

/** Nomes de catálogo (pilar/bloco/item/kpi/tool), nome da série e datas das ocorrências. */
async function loadFollowCatalog(
  supabase: SupabaseClient<Database>,
  seriesId: string,
  actions: { pilar_id: string | null; secao_id?: string | null; bloco_id: string | null; item_id: string | null; kpi_id: string | null; tool_id: string | null; occurrence_id: string | null }[],
) {
  const occIds = [...new Set(actions.map((a) => a.occurrence_id).filter((x): x is string => !!x))];
  const [{ data: series }, { data: pilares }, { data: secoes }, { data: blocos }, { data: itens }, { data: kpis }, { data: tools }, { data: occs }] = await Promise.all([
    supabase.from("meeting_series").select("name").eq("id", seriesId).maybeSingle(),
    supabase.from("sdpo_pilares").select("id, name"),
    supabase.from("sdpo_secoes").select("id, name"),
    supabase.from("sdpo_blocos").select("id, name"),
    supabase.from("sdpo_itens").select("id, name"),
    supabase.from("action_kpis").select("id, name"),
    supabase.from("action_tools").select("id, name"),
    occIds.length ? supabase.from("meeting_occurrences").select("id, occurred_on").in("id", occIds) : Promise.resolve({ data: [] as { id: string; occurred_on: string }[] }),
  ]);
  return {
    seriesName: (series as { name: string } | null)?.name ?? null,
    pilar: new Map((pilares ?? []).map((p) => [p.id, p.name])),
    secao: new Map((secoes ?? []).map((s) => [s.id, s.name])),
    bloco: new Map((blocos ?? []).map((b) => [b.id, b.name])),
    item: new Map((itens ?? []).map((i) => [i.id, i.name])),
    kpi: new Map((kpis ?? []).map((k) => [k.id, k.name])),
    tool: new Map((tools ?? []).map((t) => [t.id, t.name])),
    occDate: new Map((occs ?? []).map((o) => [o.id, o.occurred_on])),
  };
}

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

/** Importa o TOR de um Excel no padrão SDPO (mesmo ParsedTor do PDF). */
export async function parseTorExcel(formData: FormData): Promise<ParseTorResult> {
  try {
    await actionContext(); // garante sessão
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "Arquivo inválido." };
    if (file.size > 15 * 1024 * 1024) return { ok: false, error: "Arquivo muito grande (máx. 15 MB)." };

    const buf = new Uint8Array(await file.arrayBuffer());
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames[0];
    const ws = sheetName ? wb.Sheets[sheetName] : undefined;
    if (!ws) return { ok: false, error: "Planilha vazia ou ilegível." };

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" }) as (string | number)[][];
    return { ok: true, data: parseTorRows(rows, sheetName) };
  } catch (e) {
    return { ok: false, error: "Falha ao processar o Excel: " + (e as Error).message };
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
  is_private: boolean;
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
    const { supabase, userId, role } = await actionContext();
    if (input.id && !(await canEditSeries(supabase, userId, role, input.id))) {
      return { error: "Você não tem permissão para editar esta reunião. Apenas o dono, administradores ou o proprietário podem editar." };
    }
    // validações de campos obrigatórios (defesa no servidor, além do formulário)
    if (!input.name?.trim()) return { error: "Informe o nome da reunião." };
    if (!input.objetivo?.trim()) return { error: "Informe o objetivo da reunião." };
    if (!input.owner?.trim()) return { error: "Informe o dono (cargo/descrição)." };
    if (!input.periodicity) return { error: "Selecione a frequência." };
    if (!input.next_date) return { error: "Informe a data da próxima reunião." };
    if (!input.start_time) return { error: "Informe o horário de início." };
    if (!input.duration_min || Number(input.duration_min) <= 0) return { error: "Informe a duração da reunião." };
    if (!input.owner_user_id) return { error: "Selecione o usuário responsável (dono)." };
    if (!input.is_online && !input.room_id) return { error: "Selecione uma sala ou marque a reunião como online." };
    if (!input.units?.length) return { error: "Selecione ao menos uma unidade." };
    if (!input.participants_text?.trim()) return { error: "Descreva os participantes." };
    if (!input.participants?.length) return { error: "Selecione ao menos um usuário participante." };
    if (!input.content?.some((c) => c.item?.trim())) return { error: "Adicione ao menos um item no Conteúdo / Pauta." };
    if (!input.general_rules?.some((r) => r?.trim())) return { error: "Informe ao menos uma Regra Geral." };
    if (!input.how_to?.some((r) => r?.trim())) return { error: "Informe ao menos um item em Como Realizar." };
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

/** Inicia uma reunião: cria a ocorrência em andamento (cronômetro), reserva a sala (se informada) e guarda o link. */
export async function startOccurrence(seriesId: string, opts?: { roomId?: string | null; link?: string | null }): Promise<ActionState & { occurrenceId?: string }> {
  try {
    const { supabase } = await actionContext();
    if (!seriesId) return { error: "Reunião inválida." };
    const { data, error } = await supabase.rpc("start_meeting_occurrence", {
      p_series_id: seriesId,
      p_room_id: opts?.roomId || null,
      p_link: opts?.link?.trim() || null,
    });
    if (error) return { error: error.message };
    revalidatePath(RP);
    revalidatePath("/salas");
    return { ok: true, occurrenceId: data as string };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Antecipa a reunião: inicia antes da data agendada e define a próxima reunião informada. */
export async function anticipateOccurrence(
  seriesId: string,
  opts: { roomId?: string | null; link?: string | null; nextDate: string; nextTime?: string | null },
): Promise<ActionState & { occurrenceId?: string }> {
  try {
    const { supabase } = await actionContext();
    if (!seriesId) return { error: "Reunião inválida." };
    if (!opts.nextDate) return { error: "Informe a data da próxima reunião." };
    const { data, error } = await supabase.rpc("anticipate_meeting_occurrence", {
      p_series_id: seriesId,
      p_room_id: opts.roomId || null,
      p_link: opts.link?.trim() || null,
      p_next_date: opts.nextDate,
      p_next_time: opts.nextTime?.trim() || null,
    });
    if (error) return { error: error.message };
    revalidatePath(RP);
    revalidatePath("/salas");
    return { ok: true, occurrenceId: data as string };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type FinishOccurrenceInput = {
  occurrence_id: string;
  notes: string;
  decisions: string;
  transcript: string;
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
    is_sdpo: boolean; pilar_id: string; secao_id: string; bloco_id: string; item_id: string;
    meeting_series_id: string; kpi_id: string; tool_id: string; requester_id: string;
    problem_statement: string;
    due_date: string; priority: string; cc: string[];
    demandas: { description: string; assignees: string[] }[];
  };
  summary: string;
  source?: "ai" | "manual";
};

export type OccurrenceDraft = {
  notes: string;
  decisions: string;
  transcript?: string;
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
  const { supabase, userId, role } = await actionContext();
  const id = String(formData.get("id"));
  if (!(await canEditSeries(supabase, userId, role, id))) return; // sem permissão: ignora
  const active = String(formData.get("is_active")) === "true";
  await supabase.from("meeting_series").update({ is_active: !active }).eq("id", id);
  revalidatePath(RP);
}

export async function deleteSeries(formData: FormData): Promise<ActionState> {
  const { supabase, userId, role } = await actionContext();
  const id = String(formData.get("id"));
  if (!(await canEditSeries(supabase, userId, role, id))) {
    return { error: "Você não tem permissão para excluir esta reunião." };
  }
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
