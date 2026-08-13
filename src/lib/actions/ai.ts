"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { getPlatformOpenAI } from "@/lib/platform-integrations";
import type { ActionState } from "./types";

/** Owner grava/atualiza a chave da OpenAI e o modelo (validação owner-only na RPC). */
export async function setOpenAISettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const key = String(formData.get("openai_api_key") ?? "").trim();
    const model = String(formData.get("openai_model") ?? "").trim();
    const transcribeModel = String(formData.get("openai_transcribe_model") ?? "").trim();
    const clear = String(formData.get("clear") ?? "") === "1";

    if (!clear && key && !key.startsWith("sk-")) {
      return { error: "Chave inválida, a chave da OpenAI normalmente começa com \"sk-\"." };
    }

    const { error } = await supabase.rpc("platform_set_openai", {
      p_key: key,
      p_model: model,
      p_transcribe_model: transcribeModel,
      p_clear: clear,
    });
    if (error) return { error: error.message };

    revalidatePath("/admin/integracoes");
    revalidatePath("/", "layout");
    return { ok: true, message: clear ? "Chave removida." : "Configuração salva." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Owner grava/atualiza a chave do Resend (envio de convites por e-mail). */
export async function setResendSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const key = String(formData.get("resend_api_key") ?? "").trim();
    const clear = String(formData.get("clear") ?? "") === "1";

    if (!clear && key && !key.startsWith("re_")) {
      return { error: "Chave inválida — a chave do Resend normalmente começa com \"re_\"." };
    }

    const { error } = await supabase.rpc("platform_set_resend", { p_key: key, p_clear: clear });
    if (error) return { error: error.message };

    revalidatePath("/admin/integracoes");
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

    await actionContext(); // garante sessão

    // Chave centralizada na plataforma (contas do owner), lida só no servidor.
    const { apiKey, model } = await getPlatformOpenAI();
    if (!apiKey) {
      return { error: "IA não configurada. Peça ao proprietário do sistema para configurar a chave da OpenAI." };
    }

    // Contexto (objetivo/pauta/presentes) é APENAS referência para interpretar o rascunho.
    // NÃO deve ser resumido como se tivesse sido discutido: senão a IA transforma os itens
    // da pauta em anotações mesmo que o rascunho não os mencione.
    const contexto = [
      input.objetivo ? `Objetivo da reunião: ${input.objetivo}` : null,
      input.pautaItens && input.pautaItens.length ? `Pauta prevista: ${input.pautaItens.filter(Boolean).join("; ")}` : null,
      input.presentes && input.presentes.length ? `Presentes: ${input.presentes.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const system =
      "Você é um assistente que organiza registros de reuniões corporativas em português do Brasil. " +
      "Produza um JSON com exatamente duas chaves: " +
      "\"anotacoes\" (resumo claro e organizado APENAS do que consta no rascunho/transcrição, em tópicos quando fizer sentido) e " +
      "\"decisoes\" (as deliberações/decisões efetivamente tomadas, em tópicos; string vazia se não houver). " +
      "Ambos os valores DEVEM ser strings de texto (use quebras de linha e \"- \" para tópicos); nunca arrays ou objetos. " +
      "REGRA CRÍTICA DE FIDELIDADE: baseie-se EXCLUSIVAMENTE no rascunho/transcrição. " +
      "NÃO invente, não expanda nem preencha lacunas. NÃO adicione assuntos, números, KPIs, compromissos ou tópicos que não estejam escritos no rascunho. " +
      "O \"Objetivo\" e a \"Pauta prevista\" são apenas referência para você entender o rascunho: NÃO os trate como coisas que foram discutidas e NÃO os transforme em anotações. " +
      "Se um item da pauta não aparece no rascunho, ele NÃO entra nas anotações. " +
      "Se o rascunho for curto, as anotações também serão curtas, refletindo só o que foi escrito. " +
      "Não inclua nada além do JSON.";

    const user = `${contexto ? "Contexto (somente referência, NÃO resumir):\n" + contexto + "\n\n" : ""}Rascunho/transcrição (única fonte para as anotações e decisões):\n${draft}`;

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
  sdpoItens?: { item_id: string; secao_id: string; bloco_id: string; pilar_id: string; label: string }[];
  kpis?: { id: string; name: string }[];
  tools?: { id: string; name: string }[];
  // Setor e subsetor entraram na ação em 11/08 (migração 20260811190000) e a IA
  // precisa conhecê-los para o formulário não ficar pela metade na geração.
  departments?: { id: string; name: string }[];
  subdepartments?: { id: string; name: string; departmentId: string }[];
  series?: { id: string; name: string }[];
  occurrences?: { id: string; seriesId: string; occurredOn: string }[];
  today?: string; // YYYY-MM-DD (calculado no cliente para respeitar o fuso local)
  single?: boolean; // consolida tudo em UMA ação (uso na tela de Nova ação)
};

export type SuggestedActionPayload = {
  is_sdpo: boolean;
  pilar_id: string;
  secao_id: string;
  bloco_id: string;
  item_id: string;
  meeting_series_id: string;
  occurrence_id: string;
  kpi_id: string;
  tool_id: string;
  department_id: string;
  subdepartment_id: string;
  requester_id: string;
  problem_statement: string;
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

    await actionContext(); // garante sessão

    const { apiKey, model } = await getPlatformOpenAI();
    if (!apiKey) {
      return { error: "IA não configurada. Peça ao proprietário do sistema para configurar a chave da OpenAI." };
    }

    const candidates = input.candidates ?? [];
    const sdpoItens = input.sdpoItens ?? [];
    const kpis = input.kpis ?? [];
    const tools = input.tools ?? [];
    const departments = input.departments ?? [];
    const subdepartments = input.subdepartments ?? [];
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
      departments.length ? "Setores (use o índice em \"setor_index\"):\n" + numbered(departments) : null,
      // o setor pai vai no rótulo para o modelo não casar subsetor de outro setor
      subdepartments.length
        ? "Subsetores (use o índice em \"subsetor_index\"):\n" + subdepartments
            .map((s, i) => `[${i}] ${s.name} (setor: ${departments.find((d) => d.id === s.departmentId)?.name ?? "?"})`)
            .join("\n")
        : null,
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
      "\"setor_index\" (índice da lista de Setores responsáveis pela ação, ou null), " +
      "\"subsetor_index\" (índice da lista de Subsetores, ou null; use apenas subsetor que pertença ao setor escolhido), " +
      "\"reuniao_index\" (índice da lista de Reuniões, ou null), " +
      "\"referencia_data\" (data YYYY-MM-DD de uma ocorrência específica da reunião citada, ou null), " +
      "\"solicitante\" (nome de quem pediu a ação, da lista de Pessoas, ou null), " +
      "\"em_copia\" (array de nomes da lista de Pessoas que devem ter conhecimento), " +
      "\"problema\" (string: o problema, a situação ou o diagnóstico que motivou esta ação, nas palavras do próprio texto, ou null), e " +
      "\"demandas\" (array com 1+ objetos { \"descricao\": string, \"responsaveis\": [nomes] }). " +
      "Regras: para nomes (responsaveis, solicitante, em_copia) use SOMENTE nomes que aparecem na lista de Pessoas, " +
      "copiando o nome COMPLETO exatamente como está na lista; se o texto citar apenas um primeiro nome e mais de uma " +
      "pessoa da lista puder corresponder, use null em vez de escolher uma; " +
      "para índices use SOMENTE valores válidos dos catálogos fornecidos (nunca invente índices); " +
      "preencha um campo APENAS quando a informação estiver clara no texto — caso contrário use null (ou array vazio). " +
      "\"ferramenta_index\": preencha SOMENTE se o texto mencionar EXPLICITAMENTE o nome de uma das Ferramentas de gestão listadas " +
      "(ex.: \"usar 5W2H\", \"aplicar PDCA\"); NUNCA infira ou deduza uma ferramenta a partir do contexto — na dúvida, use null. " +
      "\"problema\": preencha SOMENTE se o texto descrever a situação, a causa ou o motivo por trás da ação; " +
      "NUNCA reescreva a própria tarefa como se fosse o problema, e NUNCA produza frases genéricas de gestão " +
      "(ex.: \"melhorar a eficiência do processo\") — na dúvida, use null. " +
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
    const draftWords = new Set(normName(draft).split(/[^a-z0-9]+/).filter(Boolean));
    const NAME_STOP = new Set(["da", "de", "do", "das", "dos", "e"]);
    const matchPerson = (raw: unknown): string | null => {
      const q = normName(toText(raw));
      if (!q) return null;
      let hits = byNorm.filter((c) => c.n === q);
      if (!hits.length) {
        // aproximação exige nome E sobrenome: uma palavra só ("luiz") casava
        // com o primeiro homônimo da lista
        const words = q.split(" ").filter(Boolean);
        if (words.length < 2) return null;
        hits = byNorm.filter((c) => {
          const cw = c.n.split(" ");
          return words.every((w) => cw.includes(w));
        });
      }
      if (hits.length !== 1) return null;
      // o nome tem de estar apoiado no texto: o modelo copia o nome completo
      // da lista, então um "Luiz" solto no rascunho voltaria como homônimo
      // escolhido; as palavras do nome presentes no rascunho precisam apontar
      // para essa pessoa e para mais ninguém
      const hit = hits[0];
      const support = hit.n.split(" ").filter((w) => !NAME_STOP.has(w) && draftWords.has(w));
      if (!support.length) return null;
      const alsoMatches = byNorm.filter((c) => {
        const cw = c.n.split(" ");
        return support.every((w) => cw.includes(w));
      });
      return alsoMatches.length === 1 ? hit.id : null;
    };
    // lê um índice vindo do modelo; null/ausente NÃO é índice
    // (Number(null) === 0 transformava "não citado" no primeiro item do catálogo)
    const intAt = (raw: unknown): number | null => {
      if (typeof raw === "number" && Number.isInteger(raw)) return raw;
      if (typeof raw === "string" && /^\d+$/.test(raw.trim())) return Number(raw.trim());
      return null;
    };
    // resolve um índice de catálogo em id, com limites
    const idAt = (raw: unknown, arr: { id: string }[]): string => {
      const i = intAt(raw);
      return i !== null && i >= 0 && i < arr.length ? arr[i].id : "";
    };

    // normaliza (minúsculas, sem acento) para checar menção literal no texto
    const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const draftNorm = normalize(draft);
    // ferramenta de gestão só vale se o nome aparecer EXPLICITAMENTE no rascunho
    const toolIdIfMentioned = (raw: unknown): string => {
      const id = idAt(raw, tools);
      if (!id) return "";
      const tool = tools.find((t) => t.id === id);
      const name = tool ? normalize(tool.name).trim() : "";
      return name.length >= 2 && draftNorm.includes(name) ? id : "";
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

        const prazoDias = intAt(obj.prazo_dias);
        const due_date = addDaysISO(today, prazoDias !== null ? prazoDias : 7);

        const idx = intAt(obj.item_index);
        const sdpo = idx !== null && idx >= 0 && idx < sdpoItens.length ? sdpoItens[idx] : null;

        const kpi_id = idAt(obj.kpi_index, kpis);
        const tool_id = toolIdIfMentioned(obj.ferramenta_index);
        const meeting_series_id = idAt(obj.reuniao_index, seriesList);

        // Setor/subsetor: o modelo recebe o setor pai no rótulo, mas quem
        // garante a coerência é o código. Subsetor de outro setor derruba os
        // dois, porque meio certo aqui viraria dado errado gravado.
        const department_id = idAt(obj.setor_index, departments);
        let subdepartment_id = idAt(obj.subsetor_index, subdepartments);
        if (subdepartment_id) {
          const sub = subdepartments.find((s) => s.id === subdepartment_id);
          if (!sub || !department_id || sub.departmentId !== department_id) subdepartment_id = "";
        }

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
          secao_id: sdpo?.secao_id ?? "",
          bloco_id: sdpo?.bloco_id ?? "",
          item_id: sdpo?.item_id ?? "",
          meeting_series_id,
          occurrence_id,
          kpi_id,
          tool_id,
          department_id,
          subdepartment_id,
          requester_id,
          problem_statement: toText(obj.problema),
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
