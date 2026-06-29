"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { createServiceClient } from "@/lib/supabase/admin";
import type { ActionState } from "./types";

/** Owner grava/atualiza a chave da OpenAI e o modelo (validação owner-only na RPC). */
export async function setOpenAISettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const key = String(formData.get("openai_api_key") ?? "").trim();
    const model = String(formData.get("openai_model") ?? "").trim();
    const clear = String(formData.get("clear") ?? "") === "1";

    if (!clear && key && !key.startsWith("sk-")) {
      return { error: "Chave inválida — a chave da OpenAI normalmente começa com \"sk-\"." };
    }

    const { error } = await supabase.rpc("set_openai_settings", {
      p_key: key,
      p_model: model,
      p_clear: clear,
    });
    if (error) return { error: error.message };

    revalidatePath("/configuracoes");
    revalidatePath("/reunioes");
    return { ok: true, message: clear ? "Chave removida." : "Configuração salva." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type GenerateMeetingInput = {
  draft: string;
  objetivo?: string | null;
  pautaItens?: string[];
  presentes?: string[];
};

export type GenerateMeetingResult =
  | { ok: true; anotacoes: string; decisoes: string }
  | { ok?: false; error: string };

/** Converte qualquer formato devolvido pela IA (string, array, objeto) em texto limpo. */
function toText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    return v
      .map((item) => {
        const t = toText(item);
        return t ? `• ${t}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => {
        const t = toText(val);
        return t ? `${k}: ${t}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(v);
}

/**
 * Gera Anotações e Decisões a partir de um rascunho/transcrição.
 * A chave da OpenAI é lida no servidor via service role e nunca retorna ao cliente.
 */
export async function generateMeetingAI(input: GenerateMeetingInput): Promise<GenerateMeetingResult> {
  try {
    const draft = (input.draft ?? "").trim();
    if (!draft) return { error: "Escreva ou cole um rascunho/transcrição da reunião para a IA organizar." };

    const { tenantId } = await actionContext();

    // Leitura segura da chave (bypass de RLS, só no servidor)
    const admin = createServiceClient();
    const [{ data: secret }, { data: tenant }] = await Promise.all([
      admin.from("tenant_secrets").select("openai_api_key").eq("tenant_id", tenantId).maybeSingle(),
      admin.from("tenants").select("openai_model").eq("id", tenantId).maybeSingle(),
    ]);

    const apiKey = secret?.openai_api_key?.trim();
    if (!apiKey) {
      return { error: "IA não configurada. Peça ao proprietário para configurar a chave da OpenAI em Configurações." };
    }
    const model = tenant?.openai_model?.trim() || "gpt-4.1-mini";

    const contexto = [
      input.objetivo ? `Objetivo da reunião: ${input.objetivo}` : null,
      input.pautaItens && input.pautaItens.length ? `Pauta: ${input.pautaItens.filter(Boolean).join("; ")}` : null,
      input.presentes && input.presentes.length ? `Presentes: ${input.presentes.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const system =
      "Você é um assistente que organiza registros de reuniões corporativas em português do Brasil. " +
      "A partir de um rascunho/transcrição e do contexto da reunião, produza um JSON com exatamente duas chaves: " +
      "\"anotacoes\" (resumo claro e organizado das discussões e pontos tratados, em tópicos quando fizer sentido) e " +
      "\"decisoes\" (as deliberações/decisões efetivamente tomadas, em tópicos; string vazia se não houver). " +
      "Ambos os valores DEVEM ser strings de texto (use quebras de linha e \"- \" para tópicos); nunca arrays ou objetos. " +
      "Seja fiel ao rascunho: NÃO invente decisões, números ou compromissos que não estejam no texto. " +
      "Não inclua nada além do JSON.";

    const user = `${contexto ? contexto + "\n\n" : ""}Rascunho/transcrição:\n${draft}`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      let msg = `Falha na chamada à OpenAI (HTTP ${resp.status}).`;
      try {
        const j = JSON.parse(body);
        if (j?.error?.message) msg = `OpenAI: ${j.error.message}`;
      } catch { /* mantém msg padrão */ }
      return { error: msg };
    }

    const data = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) return { error: "A IA não retornou conteúdo. Tente novamente." };

    const cleaned = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    let parsed: { anotacoes?: unknown; decisoes?: unknown };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Sem JSON válido: usa tudo como anotações
      return { ok: true, anotacoes: content.trim(), decisoes: "" };
    }

    return {
      ok: true,
      anotacoes: toText(parsed.anotacoes),
      decisoes: toText(parsed.decisoes),
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const VALID_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

/** Normaliza nome (minúsculas, sem acentos) para casar responsáveis com a lista de pessoas. */
function normName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Soma `days` a uma data YYYY-MM-DD (em UTC, sem drift de fuso) e devolve YYYY-MM-DD. */
function addDaysISO(baseISO: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(baseISO);
  const base = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : new Date();
  base.setUTCDate(base.getUTCDate() + (Number.isFinite(days) ? Math.max(0, Math.round(days)) : 7));
  return base.toISOString().slice(0, 10);
}

export type GenerateActionsInput = {
  draft: string;
  objetivo?: string | null;
  pautaItens?: string[];
  candidates?: { id: string; name: string }[];
  sdpoItens?: { item_id: string; bloco_id: string; pilar_id: string; label: string }[];
  kpis?: { id: string; name: string }[];
  tools?: { id: string; name: string }[];
  series?: { id: string; name: string }[];
  occurrences?: { id: string; seriesId: string; occurredOn: string }[];
  today?: string; // YYYY-MM-DD (calculado no cliente para respeitar o fuso local)
  single?: boolean; // consolida tudo em UMA ação (uso na tela de Nova ação)
};

export type SuggestedActionPayload = {
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
  priority: string;
  cc: string[];
  demandas: { description: string; assignees: string[] }[];
};

export type GenerateActionsResult =
  | { ok: true; actions: { payload: SuggestedActionPayload; summary: string }[] }
  | { ok?: false; error: string };

/**
 * Sugere ações (cabeçalho + demandas) a partir de um rascunho/transcrição da reunião.
 * Tenta casar responsáveis com a lista de pessoas e classificar Pilar→Bloco→Item (SDPO).
 * A chave da OpenAI é lida no servidor via service role e nunca retorna ao cliente.
 */
export async function generateActionsAI(input: GenerateActionsInput): Promise<GenerateActionsResult> {
  try {
    const draft = (input.draft ?? "").trim();
    if (!draft) return { error: "Escreva ou cole um rascunho/transcrição da reunião para a IA sugerir ações." };

    const { tenantId } = await actionContext();

    const admin = createServiceClient();
    const [{ data: secret }, { data: tenant }] = await Promise.all([
      admin.from("tenant_secrets").select("openai_api_key").eq("tenant_id", tenantId).maybeSingle(),
      admin.from("tenants").select("openai_model").eq("id", tenantId).maybeSingle(),
    ]);

    const apiKey = secret?.openai_api_key?.trim();
    if (!apiKey) {
      return { error: "IA não configurada. Peça ao proprietário para configurar a chave da OpenAI em Configurações." };
    }
    const model = tenant?.openai_model?.trim() || "gpt-4.1-mini";

    const candidates = input.candidates ?? [];
    const sdpoItens = input.sdpoItens ?? [];
    const kpis = input.kpis ?? [];
    const tools = input.tools ?? [];
    const seriesList = input.series ?? [];
    const occurrences = input.occurrences ?? [];
    const today =
      input.today && /^\d{4}-\d{2}-\d{2}$/.test(input.today) ? input.today : new Date().toISOString().slice(0, 10);

    const numbered = (arr: { name: string }[]) => arr.map((x, i) => `[${i}] ${x.name}`).join("\n");

    const contexto = [
      input.objetivo ? `Objetivo da reunião: ${input.objetivo}` : null,
      input.pautaItens && input.pautaItens.length ? `Pauta: ${input.pautaItens.filter(Boolean).join("; ")}` : null,
      `Hoje é ${today}.`,
      candidates.length ? `Pessoas (para responsáveis, solicitante e em cópia): ${candidates.map((c) => c.name).join(", ")}` : null,
      sdpoItens.length
        ? "Catálogo SDPO (use o índice em \"item_index\"):\n" + sdpoItens.map((it, i) => `[${i}] ${it.label}`).join("\n")
        : null,
      kpis.length ? "KPIs (use o índice em \"kpi_index\"):\n" + numbered(kpis) : null,
      tools.length ? "Ferramentas de gestão (use o índice em \"ferramenta_index\"):\n" + numbered(tools) : null,
      seriesList.length ? "Reuniões (use o índice em \"reuniao_index\"):\n" + numbered(seriesList) : null,
    ]
      .filter(Boolean)
      .join("\n");

    const system =
      "Você é um assistente que extrai planos de ação de reuniões corporativas em português do Brasil. " +
      "A partir de um rascunho/transcrição e do contexto, identifique as ações/tarefas combinadas e produza um JSON " +
      "com exatamente uma chave \"acoes\": um array de objetos. Cada objeto pode ter os campos: " +
      "\"titulo\" (string curta), " +
      "\"prioridade\" (uma de: low, medium, high, urgent), " +
      "\"prazo_dias\" (inteiro: dias a partir de hoje para a conclusão), " +
      "\"item_index\" (índice do Catálogo SDPO, ou null), " +
      "\"kpi_index\" (índice da lista de KPIs, ou null), " +
      "\"ferramenta_index\" (índice da lista de Ferramentas de gestão, ou null), " +
      "\"reuniao_index\" (índice da lista de Reuniões, ou null), " +
      "\"referencia_data\" (data YYYY-MM-DD de uma ocorrência específica da reunião citada, ou null), " +
      "\"solicitante\" (nome de quem pediu a ação, da lista de Pessoas, ou null), " +
      "\"em_copia\" (array de nomes da lista de Pessoas que devem ter conhecimento), e " +
      "\"demandas\" (array com 1+ objetos { \"descricao\": string, \"responsaveis\": [nomes] }). " +
      "Regras: para nomes (responsaveis, solicitante, em_copia) use SOMENTE nomes que aparecem na lista de Pessoas; " +
      "para índices use SOMENTE valores válidos dos catálogos fornecidos (nunca invente índices); " +
      "preencha um campo APENAS quando a informação estiver clara no texto — caso contrário use null (ou array vazio). " +
      "seja fiel ao texto — NÃO invente nada que não esteja no rascunho. " +
      (input.single
        ? "IMPORTANTE: consolide TUDO em UMA única ação (um único objeto no array \"acoes\") com quantas demandas forem necessárias. "
        : "") +
      "Se não houver nenhuma ação clara, devolva { \"acoes\": [] }. Não inclua nada além do JSON.";

    const user = `${contexto ? contexto + "\n\n" : ""}Rascunho/transcrição:\n${draft}`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      let msg = `Falha na chamada à OpenAI (HTTP ${resp.status}).`;
      try {
        const j = JSON.parse(body);
        if (j?.error?.message) msg = `OpenAI: ${j.error.message}`;
      } catch { /* mantém msg padrão */ }
      return { error: msg };
    }

    const data = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) return { error: "A IA não retornou conteúdo. Tente novamente." };

    const cleaned = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    let parsed: { acoes?: unknown };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return { error: "A IA devolveu um formato inesperado. Tente novamente." };
    }

    const rawAcoes = Array.isArray(parsed.acoes) ? parsed.acoes : [];

    // índice de pessoas normalizado para casar nomes (responsável, solicitante, em cópia)
    const byNorm = candidates.map((c) => ({ id: c.id, n: normName(c.name) }));
    const matchPerson = (raw: unknown): string | null => {
      const q = normName(toText(raw));
      if (!q) return null;
      const exact = byNorm.find((c) => c.n === q);
      if (exact) return exact.id;
      const partial = byNorm.find((c) => c.n.includes(q) || q.includes(c.n));
      return partial ? partial.id : null;
    };
    // resolve um índice de catálogo em id, com limites
    const idAt = (raw: unknown, arr: { id: string }[]): string => {
      const i = Number(raw);
      return Number.isInteger(i) && i >= 0 && i < arr.length ? arr[i].id : "";
    };

    const actions = rawAcoes
      .map((a) => {
        const obj = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;

        const demandasRaw = Array.isArray(obj.demandas) ? obj.demandas : [];
        const demandas = demandasRaw
          .map((d) => {
            const dObj = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
            const description = toText(dObj.descricao ?? dObj.description);
            const respRaw = Array.isArray(dObj.responsaveis) ? dObj.responsaveis : [];
            const assignees = Array.from(
              new Set(respRaw.map(matchPerson).filter((x): x is string => !!x)),
            );
            return { description, assignees };
          })
          .filter((d) => d.description.trim());

        if (demandas.length === 0) return null;

        const priorityRaw = toText(obj.prioridade ?? obj.priority).toLowerCase();
        const priority = (VALID_PRIORITIES as readonly string[]).includes(priorityRaw) ? priorityRaw : "medium";

        const prazoDias = Number(obj.prazo_dias);
        const due_date = addDaysISO(today, Number.isFinite(prazoDias) ? prazoDias : 7);

        const idx = Number(obj.item_index);
        const sdpo =
          Number.isInteger(idx) && idx >= 0 && idx < sdpoItens.length ? sdpoItens[idx] : null;

        const kpi_id = idAt(obj.kpi_index, kpis);
        const tool_id = idAt(obj.ferramenta_index, tools);
        const meeting_series_id = idAt(obj.reuniao_index, seriesList);

        // referência da reunião: casa a data informada com uma ocorrência da reunião escolhida
        let occurrence_id = "";
        const refData = toText(obj.referencia_data);
        if (meeting_series_id && /^\d{4}-\d{2}-\d{2}$/.test(refData)) {
          const occ = occurrences.find((o) => o.seriesId === meeting_series_id && o.occurredOn === refData);
          if (occ) occurrence_id = occ.id;
        }

        const requester_id = matchPerson(obj.solicitante) ?? "";
        const ccRaw = Array.isArray(obj.em_copia) ? obj.em_copia : [];
        const cc = Array.from(
          new Set(ccRaw.map(matchPerson).filter((x): x is string => !!x && x !== requester_id)),
        );

        const titulo = toText(obj.titulo ?? obj.title);
        const summary = titulo || demandas.map((d) => d.description).join("; ");

        const payload: SuggestedActionPayload = {
          is_sdpo: !!sdpo,
          pilar_id: sdpo?.pilar_id ?? "",
          bloco_id: sdpo?.bloco_id ?? "",
          item_id: sdpo?.item_id ?? "",
          meeting_series_id,
          occurrence_id,
          kpi_id,
          tool_id,
          requester_id,
          due_date,
          priority,
          cc,
          demandas,
        };
        return { payload, summary };
      })
      .filter((x): x is { payload: SuggestedActionPayload; summary: string } => !!x);

    if (actions.length === 0) {
      return { error: "A IA não identificou ações claras no texto. Detalhe melhor as tarefas e os responsáveis." };
    }

    return { ok: true, actions };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
