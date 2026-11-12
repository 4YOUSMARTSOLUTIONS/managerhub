import { getPlatformOpenAI } from "@/lib/platform-integrations";

/*
 * Leitura do atestado com IA (LUIZ, 11/11/2026). Módulo de servidor sem
 * "use server": quem chama é a action `lerAtestadoComIA`, que acha o arquivo e
 * confere quem pede. A chave da OpenAI é a da plataforma e não sai daqui.
 */

/** O que a IA conseguiu ler do atestado; o que não leu vem null. */
export type AtestadoLidoPorIA = {
  tipoAtestado: "medico" | "odontologico" | null;
  /** código da tabela oficial (a descrição vem dela, não da IA) */
  cid: string | null;
  cidDescricao: string | null;
  /** o código que a IA leu e que não existe na tabela: a tela avisa e deixa o campo vazio */
  cidNaoEncontrado: string | null;
  medico: string | null;
  crm: string | null;
  local: string | null;
  emitidoEm: string | null;
  acompanhado: string | null;
};

/** O que a leitura aceita: foto ou PDF (HEIC a OpenAI não lê). */
export const MIMES_LEITURA_IA = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

/**
 * Manda o atestado à OpenAI e devolve o que deu para ler, já conferido: o CID
 * passa pela tabela oficial (`acharCid`), a data de emissão precisa ser uma
 * data de verdade e não estar no futuro, e o que veio vazio fica null.
 */
export async function lerAtestadoNaOpenAI(
  arquivo: { bytes: ArrayBuffer; tipo: string; nome: string },
  acharCid: (codigo: string) => Promise<{ code: string; description: string } | null>,
  /** outro modelo no lugar do configurado (para comparar modelos sem mexer na configuração) */
  modeloForcado?: string,
): Promise<{ data?: AtestadoLidoPorIA; error?: string }> {
  const { bytes, tipo, nome } = arquivo;
    const { apiKey, visionModel } = await getPlatformOpenAI();
    const model = modeloForcado || visionModel;
    if (!apiKey) return { error: "IA não configurada. Peça ao proprietário do sistema para configurar a chave da OpenAI." };

    const base64 = Buffer.from(bytes).toString("base64");
    const documento = tipo === "application/pdf"
      ? { type: "file", file: { filename: nome, file_data: `data:application/pdf;base64,${base64}` } }
      : { type: "image_url", image_url: { url: `data:${tipo};base64,${base64}`, detail: "high" } };

    const system =
      "Você lê atestados médicos e odontológicos brasileiros (foto ou PDF) e devolve SOMENTE um JSON com as chaves: " +
      "\"tipo_atestado\" (\"medico\" ou \"odontologico\"), " +
      "\"cid\" (o código CID-10 como está escrito, ex.: \"J11.1\"; null se só houver a descrição da doença, sem código), " +
      "\"profissional\" (nome do médico ou dentista que assina), " +
      "\"registro\" (CRM, CRO ou outro registro profissional, com a sigla e a UF quando houver, ex.: \"CRM-BA 12345\"), " +
      "\"local\" (hospital, clínica ou unidade de saúde que emitiu), " +
      "\"emitido_em\" (data de emissão no formato AAAA-MM-DD), " +
      "\"acompanhado\" (nome de quem foi acompanhado, só se for atestado de acompanhamento; senão null). " +
      "Use null para o que não constar ou não estiver legível. NÃO invente, NÃO deduza e NÃO complete: na dúvida, null. " +
      "Não inclua nada além do JSON.";

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        // os modelos de raciocínio (gpt-5.x, o*) só aceitam a temperatura padrão
        ...(/^gpt-4/.test(model) ? { temperature: 0 } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: [{ type: "text", text: "Leia este atestado e devolva o JSON." }, documento] },
        ],
      }),
    });
    if (!resp.ok) {
      const corpo = await resp.text();
      let msg = `A leitura falhou (OpenAI, HTTP ${resp.status}). Preencha manualmente.`;
      try {
        const j = JSON.parse(corpo);
        if (j?.error?.message) msg = `A leitura falhou: ${j.error.message}`;
      } catch { /* mantém a mensagem padrão */ }
      return { error: msg };
    }
    const resposta = await resp.json();
    const texto: string = resposta?.choices?.[0]?.message?.content ?? "";
    let lido: Record<string, unknown>;
    try {
      lido = JSON.parse(texto.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
    } catch {
      return { error: "A IA não devolveu uma leitura válida. Preencha manualmente." };
    }

    const txt = (v: unknown) => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : null);

    // o CID passa pela tabela oficial: a descrição vem dela, e código que não existe não entra
    let cid: string | null = null;
    let cidDescricao: string | null = null;
    let cidNaoEncontrado: string | null = null;
    const cidLido = txt(lido.cid)?.toUpperCase().replace(/\s+/g, "") ?? null;
    if (cidLido) {
      const m = /^([A-Z]\d{2})\.?(\d)?$/.exec(cidLido);
      const codigo = m ? m[1] + (m[2] ? `.${m[2]}` : "") : null;
      const achado = codigo ? await acharCid(codigo) : null;
      if (achado) { cid = achado.code; cidDescricao = achado.description; } else cidNaoEncontrado = cidLido;
    }

    // data de emissão: só se for uma data de verdade e não estiver no futuro
    const emitido = txt(lido.emitido_em);
    const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    const emitidoEm = emitido && /^\d{4}-\d{2}-\d{2}$/.test(emitido) && !Number.isNaN(Date.parse(emitido)) && emitido <= hoje
      ? emitido : null;

    const tipoLido = txt(lido.tipo_atestado)?.toLowerCase() ?? "";
    return {
      data: {
        tipoAtestado: tipoLido.startsWith("odonto") ? "odontologico" : tipoLido.startsWith("medic") || tipoLido.startsWith("médic") ? "medico" : null,
        cid, cidDescricao, cidNaoEncontrado,
        medico: txt(lido.profissional),
        crm: txt(lido.registro),
        local: txt(lido.local),
        emitidoEm,
        acompanhado: txt(lido.acompanhado),
      },
    };
}
