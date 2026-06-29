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
