"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

const BUCKET = "action-attachments";

export type ActionPayload = {
  is_sdpo: boolean;
  pilar_id: string;
  secao_id: string;
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
    if (!payload.due_date) return { error: "Informe o prazo da ação." };
    if (payload.is_sdpo && (!payload.pilar_id || !payload.secao_id || !payload.item_id)) {
      return { error: "Para ações do Programa de Excelência, informe Pilar, Seção e Item." };
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

// ---------- Importação de ações (owner) ----------
const normTxt = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

const PRIORITY_BY_INPUT: Record<string, Enums<"priority_level">> = {
  baixa: "low", low: "low",
  media: "medium", "média": "medium", medium: "medium", normal: "medium",
  alta: "high", high: "high",
  urgente: "urgent", urgent: "urgent",
};

// rótulos de status aceitos na planilha → enum action_status
const STATUS_BY_INPUT: Record<string, Enums<"action_status">> = {
  aberta: "open", aberto: "open", open: "open", pendente: "open", "a fazer": "open",
  "em andamento": "in_progress", andamento: "in_progress", "em progresso": "in_progress", in_progress: "in_progress", fazendo: "in_progress",
  bloqueada: "blocked", bloqueado: "blocked", blocked: "blocked", impedida: "blocked", impedido: "blocked",
  atrasada: "open", atrasado: "open", // atraso é derivado do prazo; a ação segue aberta
  concluida: "done", concluido: "done", concluída: "done", concluído: "done", done: "done", feita: "done", feito: "done", finalizada: "done", finalizado: "done",
  cancelada: "cancelled", cancelado: "cancelled", cancelled: "cancelled", canceled: "cancelled",
};

// "Aguardando aprovação" (ou "... - Aprovação Pendente"): não é um status armazenável,
// e sim a parte enviada pelo responsável sem aprovação. Detectado à parte na importação.
const isAwaitingApproval = (raw: string) => {
  const s = normTxt(raw ?? "");
  return s.includes("aguardando aprov") || s.includes("aprovacao pendente");
};

export type ActionImportRow = {
  descricao: string;
  responsaveis: string;
  solicitante: string;
  dataCriacao: string; // yyyy-mm-dd (normalizado no cliente) ou ""
  criadaPor: string;
  reuniao: string;
  prazo: string; // yyyy-mm-dd ou ""
  dataConclusao: string; // yyyy-mm-dd ou ""
  status: string;
  prioridade: string;
  unidade: string;
  kpi: string;
  ferramenta: string;
  sdpo: string;
  programa: string;
  pilar: string;
  secao: string;
  bloco: string;
  item: string;
  comentarios: { at: string; author: string; text: string }[]; // já parseados no cliente
};

export type ActionImportResult = {
  created: number;
  skipped: number;
  peopleNotFound: string[];
  refsNotFound: string[];
  failed: string[]; // linhas que falharam na gravação (não abortam o restante)
  error?: string;   // erro fatal (ex.: sem permissão) que interrompe tudo
};

export async function importActions(rows: ActionImportRow[]): Promise<ActionImportResult> {
  const base: ActionImportResult = { created: 0, skipped: 0, peopleNotFound: [], refsNotFound: [], failed: [] };
  try {
    const { supabase, tenantId, userId, role } = await actionContext();
    if (role !== "owner") return { ...base, error: "Apenas o proprietário pode importar ações." };

    const [{ data: mems }, { data: units }, { data: kpis }, { data: tools }, { data: pilares }, { data: secoesData }, { data: blocos }, { data: itens }, { data: series }, { data: programas }] = await Promise.all([
      // hint obrigatório: memberships tem 2 FKs para profiles (user_id e manager_id).
      // Sem ele o embed é ambíguo, a consulta falha e nenhum nome é resolvido.
      supabase.from("memberships").select("user_id, profiles!memberships_user_id_fkey(full_name)").eq("tenant_id", tenantId),
      supabase.from("units").select("id, name").eq("tenant_id", tenantId),
      supabase.from("action_kpis").select("id, name").eq("tenant_id", tenantId),
      supabase.from("action_tools").select("id, name").eq("tenant_id", tenantId),
      supabase.from("sdpo_pilares").select("id, name").eq("tenant_id", tenantId),
      supabase.from("sdpo_secoes").select("id, name").eq("tenant_id", tenantId),
      supabase.from("sdpo_blocos").select("id, name").eq("tenant_id", tenantId),
      supabase.from("sdpo_itens").select("id, name").eq("tenant_id", tenantId),
      supabase.from("meeting_series").select("id, name").eq("tenant_id", tenantId).is("deleted_at", null),
      supabase.from("sdpo_programas").select("id, name").eq("tenant_id", tenantId),
    ]);

    const userByName = new Map<string, string>();
    for (const m of mems ?? []) {
      const nm = (m.profiles as unknown as { full_name: string | null } | null)?.full_name;
      if (nm) userByName.set(normTxt(nm), m.user_id as string);
    }
    const idByName = (list: { id: string; name: string }[] | null) => {
      const map = new Map<string, string>();
      for (const x of list ?? []) map.set(normTxt(x.name), x.id);
      return map;
    };
    const unitMap = idByName(units), kpiMap = idByName(kpis), toolMap = idByName(tools);
    const pilarMap = idByName(pilares), secaoMap = idByName(secoesData), blocoMap = idByName(blocos), itemMap = idByName(itens);
    const seriesMap = idByName(series), programaMap = idByName(programas);
    const isoDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test((s ?? "").trim()) ? s.trim() : "");

    const peopleNotFound = new Set<string>();
    const refsNotFound = new Set<string>();
    const resolvePerson = (raw: string) => {
      const key = normTxt(raw);
      if (!key) return null;
      const id = userByName.get(key);
      if (!id) peopleNotFound.add(raw.trim());
      return id ?? null;
    };
    const resolveRef = (raw: string, map: Map<string, string>, label: string) => {
      const key = normTxt(raw);
      if (!key) return "";
      const id = map.get(key);
      if (!id) refsNotFound.add(`${label}: ${raw.trim()}`);
      return id ?? "";
    };
    // Unidade: vazio, "Todas" ou "Todas as unidades" = sem unidade específica (todas), sem alerta.
    const resolveUnit = (raw: string) => {
      const key = normTxt(raw);
      if (!key || key === "todas" || key === "todas as unidades") return "";
      const id = unitMap.get(key);
      if (!id) refsNotFound.add(`Unidade: ${(raw ?? "").trim()}`);
      return id ?? "";
    };

    for (const r of rows) {
      const descricao = (r.descricao ?? "").trim();
      if (!descricao) { base.skipped += 1; continue; }

      // Migração: vincula quem existe; o que não casar é preservado como texto (legacy_*).
      const legacyOf = (raw: string, id: string) => (raw?.trim() && !id ? raw.trim() : "");

      // responsáveis: vincula os que existem; guarda os demais como texto
      const respNames = (r.responsaveis ?? "").split(/[;,\n]/).map((x) => x.trim()).filter(Boolean);
      const assignees: string[] = [];
      const unresolvedResp: string[] = [];
      for (const nm of respNames) {
        const id = resolvePerson(nm);
        if (id) assignees.push(id); else unresolvedResp.push(nm);
      }
      const legacy_assignees = unresolvedResp.join(", ");

      // solicitante: sem fallback para o owner; se não casar, fica só o texto original
      const solTxt = (r.solicitante ?? "").trim();
      const requester_id = solTxt ? (resolvePerson(r.solicitante) ?? "") : "";
      const legacy_requester = solTxt && !requester_id ? solTxt : "";

      // criada por: created_by é obrigatório (fica o owner quando não casa), mas preserva o texto
      const criadaTxt = (r.criadaPor ?? "").trim();
      const criadaResolved = criadaTxt ? resolvePerson(r.criadaPor) : null;
      const createdBy = criadaResolved ?? userId;
      const legacy_created_by = criadaTxt && !criadaResolved ? criadaTxt : "";

      const programa_id = resolveRef(r.programa, programaMap, "Programa");
      const pilar_id = resolveRef(r.pilar, pilarMap, "Pilar");
      const secao_id = resolveRef(r.secao, secaoMap, "Seção");
      const bloco_id = resolveRef(r.bloco, blocoMap, "Bloco");
      const item_id = resolveRef(r.item, itemMap, "Item");
      // SDPO: usa a coluna quando preenchida; se vazia, deduz da classificação completa
      const sdpoTxt = normTxt(r.sdpo ?? "");
      const is_sdpo = sdpoTxt
        ? ["sim", "s", "true", "1", "sdpo"].includes(sdpoTxt)
        : !!(pilar_id && secao_id && item_id);
      const meeting_series_id = resolveRef(r.reuniao, seriesMap, "Reunião");
      const kpi_id = resolveRef(r.kpi, kpiMap, "KPI");
      const tool_id = resolveRef(r.ferramenta, toolMap, "Ferramenta");
      const unit_id = resolveUnit(r.unidade);
      const unitTxt = (r.unidade ?? "").trim();
      const legacy_unit = unitTxt && !unit_id && !["todas", "todas as unidades"].includes(normTxt(unitTxt)) ? unitTxt : "";

      const awaiting = isAwaitingApproval(r.status ?? "");
      const status = awaiting
        ? "in_progress"
        : (STATUS_BY_INPUT[normTxt(r.status ?? "")] ?? (isoDate(r.dataConclusao) ? "done" : "open"));

      const p_data = {
        is_sdpo,
        programa_id,
        pilar_id, secao_id, bloco_id, item_id,
        meeting_series_id,
        kpi_id,
        tool_id,
        unit_id,
        requester_id,
        created_by: createdBy,
        created_at: isoDate(r.dataCriacao),
        completed_at: isoDate(r.dataConclusao),
        status,
        awaiting_approval: awaiting,
        due_date: isoDate(r.prazo),
        priority: PRIORITY_BY_INPUT[normTxt(r.prioridade ?? "")] ?? "medium",
        cc: [] as string[],
        description: descricao,
        legacy_programa: legacyOf(r.programa, programa_id),
        legacy_pilar: legacyOf(r.pilar, pilar_id),
        legacy_secao: legacyOf(r.secao, secao_id),
        legacy_bloco: legacyOf(r.bloco, bloco_id),
        legacy_item: legacyOf(r.item, item_id),
        legacy_requester,
        legacy_created_by,
        legacy_meeting: legacyOf(r.reuniao, meeting_series_id),
        legacy_unit,
        legacy_kpi: legacyOf(r.kpi, kpi_id),
        legacy_tool: legacyOf(r.ferramenta, tool_id),
        legacy_assignees,
        assignees,
      };

      const { data: result, error } = await supabase.rpc("import_action", { p_data });
      if (error) { base.failed.push(`${descricao.slice(0, 60)}: ${error.message}`); continue; }
      base.created += 1;

      // comentários (histórico do sistema antigo): sem notificar, preservando data/autor
      const demandaId = ((result ?? {}) as { demanda_ids?: string[] }).demanda_ids?.[0];
      if (demandaId) {
        for (const c of r.comentarios ?? []) {
          const text = (c.text ?? "").trim();
          if (!text) continue;
          const actorId = c.author?.trim() ? resolvePerson(c.author) : null;
          await supabase.rpc("add_demanda_comment_import", {
            p_demanda: demandaId,
            p_body: text,
            p_actor: actorId,
            p_at: /^\d{4}-\d{2}-\d{2}/.test((c.at ?? "").trim()) ? c.at.trim() : null,
            p_author_label: c.author?.trim() || null,
          });
        }
      }
    }

    revalidatePath("/acoes");
    revalidatePath("/dashboard");
    return { ...base, peopleNotFound: [...peopleNotFound], refsNotFound: [...refsNotFound] };
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}

// ---------- Tratamento da demanda/ação ----------
function rv() {
  revalidatePath("/acoes");
  revalidatePath("/dashboard");
}

export async function demandaSetStatus(demandaId: string, status: Enums<"action_status">): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("demanda_set_status", { p_demanda: demandaId, p_status: status });
    if (error) return { error: error.message };
    rv();
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function demandaComment(demandaId: string, body: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("demanda_comment", { p_demanda: demandaId, p_body: body });
    if (error) return { error: error.message };
    rv();
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function demandaRequest(demandaId: string, type: "prazo" | "conclusao", newDue: string, note: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("demanda_request", { p_demanda: demandaId, p_type: type, p_new_due: newDue || null, p_note: note });
    if (error) return { error: error.message };
    rv();
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function demandaDecide(requestId: string, approve: boolean, note: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("demanda_decide", { p_request: requestId, p_approve: approve, p_note: note });
    if (error) return { error: error.message };
    rv();
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function demandaReopen(demandaId: string, note: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("demanda_reopen", { p_demanda: demandaId, p_note: note });
    if (error) return { error: error.message };
    rv();
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function demandaCancel(demandaId: string, note: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("demanda_cancel", { p_demanda: demandaId, p_note: note });
    if (error) return { error: error.message };
    rv();
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function demandaReassign(demandaId: string, userIds: string[], note: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("demanda_reassign", { p_demanda: demandaId, p_users: userIds, p_note: note });
    if (error) return { error: error.message };
    rv();
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Responsável marca "concluí minha parte" (auto-aprova se for o solicitante). */
export async function demandaAssigneeSubmit(demandaId: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("demanda_assignee_submit", { p_demanda: demandaId });
    if (error) return { error: error.message };
    rv();
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Solicitante aprova/reprova a parte de um responsável. */
export async function demandaAssigneeDecide(demandaId: string, userId: string, approve: boolean, note: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("demanda_assignee_decide", { p_demanda: demandaId, p_user: userId, p_approve: approve, p_note: note });
    if (error) return { error: error.message };
    rv();
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Reabre a parte de um responsável específico. */
export async function demandaAssigneeReopen(demandaId: string, userId: string, note: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("demanda_assignee_reopen", { p_demanda: demandaId, p_user: userId, p_note: note });
    if (error) return { error: error.message };
    rv();
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

export type TimelineEvent = { id: string; type: string; actorName: string | null; body: string | null; meta: Record<string, unknown>; createdAt: string };
export type PendingReq = { id: string; type: string; newDueDate: string | null; note: string | null; requestedByName: string | null; createdAt: string };

export async function getDemandaTimeline(demandaId: string): Promise<{ events: TimelineEvent[]; requests: PendingReq[]; status: Enums<"action_status">; dueDate: string | null }> {
  const { supabase, tenantId } = await actionContext();
  const [{ data: events }, { data: reqs }, { data: profs }, { data: dem }] = await Promise.all([
    supabase.from("demanda_events").select("id, type, actor_id, body, meta, created_at").eq("demanda_id", demandaId).order("created_at", { ascending: true }),
    supabase.from("demanda_requests").select("id, type, new_due_date, note, requested_by, created_at").eq("demanda_id", demandaId).eq("status", "pending"),
    supabase.from("memberships").select("user_id, profiles!memberships_user_id_fkey(full_name)").eq("tenant_id", tenantId),
    supabase.from("action_demandas").select("status, due_date").eq("id", demandaId).single(),
  ]);
  const nameById = new Map((profs ?? []).map((m) => [m.user_id, (m.profiles as { full_name: string | null } | null)?.full_name ?? "—"]));
  return {
    events: (events ?? []).map((e) => ({ id: e.id, type: e.type, actorName: e.actor_id ? nameById.get(e.actor_id) ?? null : null, body: e.body, meta: (e.meta as Record<string, unknown>) ?? {}, createdAt: e.created_at })),
    requests: (reqs ?? []).map((r) => ({ id: r.id, type: r.type, newDueDate: r.new_due_date, note: r.note, requestedByName: r.requested_by ? nameById.get(r.requested_by) ?? null : null, createdAt: r.created_at })),
    status: (dem?.status ?? "open") as Enums<"action_status">,
    dueDate: dem?.due_date ?? null,
  };
}

export async function deleteAction(formData: FormData): Promise<ActionState> {
  const { supabase, tenantId } = await actionContext();
  const id = String(formData.get("id"));
  // remove anexos do storage (best-effort, mas registra falha p/ não deixar órfão silencioso)
  const { data: atts } = await supabase.from("action_attachments").select("path").eq("action_id", id);
  if (atts && atts.length) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(atts.map((a) => a.path));
    if (rmErr) console.error("[actions] falha ao remover anexos do storage:", rmErr.message);
  }
  const { error } = await supabase.from("actions").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return { error: error.message };
  revalidatePath("/acoes");
  revalidatePath("/dashboard");
  return { ok: true };
}

// URL assinada para download de anexo
export async function getAttachmentUrl(path: string): Promise<string | null> {
  const { supabase } = await actionContext();
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}
