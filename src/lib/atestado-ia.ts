import { getPlatformOpenAI } from "@/lib/platform-integrations";

/*
 * Leitura do atestado com IA (LUIZ, 11/11/2026). Módulo de servidor sem
 * "use server": quem chama é a action `lerAtestadoComIA`, que acha o arquivo e
 * confere quem pede. A chave da OpenAI é a da plataforma e não sai daqui.
 *
 * Leitura conferida (12/11/2026): num atestado real o carimbo borrado saiu com o
 * nome da médica e o CRM trocados por outros parecidos, e o modelo ainda dizia
 * ter certeza. Por isso TRÊS modelos diferentes leem o mesmo arquivo em
 * paralelo, e um campo só entra quando os três leram a mesma coisa, sem nenhum
 * com certeza baixa (regra em `certo`). Com dois, num teste de carimbo coberto
 * pela assinatura, os dois chegaram a concordar no mesmo dígito errado; o
 * terceiro derruba isso.
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
  /**
   * Campos que ficaram em branco por falta de certeza: um dos modelos não teve
   * certeza alta, ou os dois leram diferente. Rótulos como na tela, para o aviso.
   */
  incertos: string[];
};

/** O que a leitura aceita: foto ou PDF (HEIC a OpenAI não lê). */
export const MIMES_LEITURA_IA = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

/** Os conferentes: dois modelos diferentes do configurado (rápidos, para o tempo não crescer). */
const conferentes = (principal: string) =>
  ["gpt-4o", "gpt-4.1-mini", "gpt-4.1"].filter((m) => m !== principal).slice(0, 2);

const SISTEMA =
  "Você lê atestados médicos e odontológicos brasileiros (foto ou PDF). Devolva SOMENTE um JSON com as chaves " +
  "abaixo, e cada uma é um objeto {\"valor\": ..., \"certeza\": \"alta\" | \"media\" | \"baixa\"}:\n" +
  "- \"tipo_atestado\": \"medico\" ou \"odontologico\";\n" +
  "- \"cid\": o código CID-10 como está escrito (ex.: \"J11.1\"); null se só houver a descrição da doença, sem código;\n" +
  "- \"profissional\": nome do médico ou dentista que assina (costuma estar no carimbo);\n" +
  "- \"registro\": CRM, CRO ou outro registro, com a sigla e a UF quando houver (ex.: \"CRM-BA 12345\");\n" +
  "- \"local\": hospital, clínica ou unidade de saúde que emitiu;\n" +
  "- \"emitido_em\": data de emissão no formato AAAA-MM-DD;\n" +
  "- \"acompanhado\": nome de quem foi acompanhado, só em atestado de acompanhamento.\n" +
  "Regras de certeza, seja rigoroso:\n" +
  "- \"alta\" SÓ quando cada letra e cada dígito do valor está nítido no documento e você não precisou adivinhar nada.\n" +
  "- Carimbo borrado, inclinado ou cortado, assinatura passando por cima, tinta fraca, letra de mão difícil, " +
  "palavra ou dígito parcialmente visível: \"media\" ou \"baixa\".\n" +
  "- NUNCA complete, corrija ou troque um nome ou número por outro parecido: se um sobrenome ou um dígito não está " +
  "legível, a certeza é \"baixa\".\n" +
  "- Campo que não consta no documento: {\"valor\": null, \"certeza\": \"alta\"}.\n" +
  "Não inclua nada além do JSON.";

type Leitura = Record<string, unknown>;

/** Uma leitura por um modelo. Erro volta como texto, para a outra leitura seguir sozinha se precisar. */
async function lerCom(model: string, apiKey: string, documento: unknown): Promise<{ lido?: Leitura; error?: string }> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      // os modelos de raciocínio (gpt-5.x, o*) só aceitam a temperatura padrão
      ...(/^gpt-4/.test(model) ? { temperature: 0 } : {}),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SISTEMA },
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
  try {
    return { lido: JSON.parse(texto.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()) };
  } catch {
    return { error: "A IA não devolveu uma leitura válida. Preencha manualmente." };
  }
}

const texto = (v: unknown) => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : null);

/** Valor e certeza de um campo numa leitura (sem certeza informada, vale como baixa). */
function campoDe(lido: Leitura, chave: string): { valor: string | null; alta: boolean; baixa: boolean } {
  const bruto = lido[chave];
  if (bruto && typeof bruto === "object") {
    const o = bruto as { valor?: unknown; certeza?: unknown };
    const c = typeof o.certeza === "string" ? o.certeza.trim().toLowerCase() : "";
    return { valor: texto(o.valor), alta: c === "alta", baixa: c !== "alta" && c !== "media" && c !== "média" };
  }
  return { valor: texto(bruto), alta: false, baixa: true };
}

/** Para comparar as duas leituras: sem acento, caixa, pontuação, espaços e o "Dr./Dra." da frente. */
const comparavel = (v: string) =>
  v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/^(dra?|dr\(a\))\.?\s+/, "")
    .replace(/[^a-z0-9]/g, "");

/**
 * Manda o atestado à OpenAI e devolve o que deu para ler, já conferido: só entra
 * o que os dois modelos leram igual e com certeza alta (o resto fica em branco e
 * volta em `incertos`), o CID passa pela tabela oficial (`acharCid`), a data de
 * emissão precisa ser uma data de verdade e não estar no futuro.
 */
export async function lerAtestadoNaOpenAI(
  arquivo: { bytes: ArrayBuffer; tipo: string; nome: string },
  acharCid: (codigo: string) => Promise<{ code: string; description: string } | null>,
  /** outro modelo no lugar do configurado (para comparar modelos sem mexer na configuração) */
  modeloForcado?: string,
): Promise<{ data?: AtestadoLidoPorIA; error?: string }> {
  const { bytes, tipo, nome } = arquivo;
  const { apiKey, visionModel } = await getPlatformOpenAI();
  const principal = modeloForcado || visionModel;
  if (!apiKey) return { error: "IA não configurada. Peça ao proprietário do sistema para configurar a chave da OpenAI." };

  const base64 = Buffer.from(bytes).toString("base64");
  const documento = tipo === "application/pdf"
    ? { type: "file", file: { filename: nome, file_data: `data:application/pdf;base64,${base64}` } }
    : { type: "image_url", image_url: { url: `data:${tipo};base64,${base64}`, detail: "high" } };

  const [a, ...outras] = await Promise.all([principal, ...conferentes(principal)].map((m) => lerCom(m, apiKey, documento)));
  if (!a.lido) return { error: a.error ?? "A leitura falhou. Preencha manualmente." };
  // conferência que falhou fica de fora; as que voltaram valem
  for (const o of outras) if (!o.lido) console.error("[atestado-ia] conferência falhou:", o.error);
  const leituras = [a.lido, ...outras.flatMap((o) => (o.lido ? [o.lido] : []))];

  const incertos: string[] = [];
  /**
   * O valor só entra quando todos os leitores leram a MESMA coisa, nenhum disse
   * certeza baixa e a maioria disse alta (com três: dois; com dois: os dois).
   * Em branco, o aviso só aparece se mais de um leitor viu algo no campo: o que
   * um só viu pode ser invenção, e aí o silêncio é o certo.
   */
  const certo = (chave: string, rotulo: string): string | null => {
    const campos = leituras.map((l) => campoDe(l, chave));
    const viram = campos.filter((c) => c.valor).length;
    if (viram === 0) return null; // todos dizem que não consta
    const principalLeu = campos[0].valor;
    const iguais = viram === campos.length && Boolean(principalLeu)
      && campos.every((c) => comparavel(c.valor!) === comparavel(principalLeu!));
    const altas = campos.filter((c) => c.alta).length;
    const confirmado = iguais && !campos.some((c) => c.baixa) && altas >= (campos.length >= 3 ? 2 : campos.length);
    if (confirmado) return principalLeu;
    if (viram >= 2) incertos.push(rotulo);
    return null;
  };

  // o CID passa pela tabela oficial: a descrição vem dela, e código que não existe não entra
  let cid: string | null = null;
  let cidDescricao: string | null = null;
  let cidNaoEncontrado: string | null = null;
  const cidLido = certo("cid", "CID")?.toUpperCase().replace(/\s+/g, "") ?? null;
  if (cidLido) {
    const m = /^([A-Z]\d{2})\.?(\d)?$/.exec(cidLido);
    const codigo = m ? m[1] + (m[2] ? `.${m[2]}` : "") : null;
    const achado = codigo ? await acharCid(codigo) : null;
    if (achado) { cid = achado.code; cidDescricao = achado.description; } else cidNaoEncontrado = cidLido;
  }

  // data de emissão: só se for uma data de verdade e não estiver no futuro
  const emitido = certo("emitido_em", "Emitido em");
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const emitidoEm = emitido && /^\d{4}-\d{2}-\d{2}$/.test(emitido) && !Number.isNaN(Date.parse(emitido)) && emitido <= hoje
    ? emitido : null;

  const tipoLido = certo("tipo_atestado", "Tipo de atestado")?.toLowerCase() ?? "";
  return {
    data: {
      tipoAtestado: tipoLido.startsWith("odonto") ? "odontologico" : tipoLido.startsWith("medic") || tipoLido.startsWith("médic") ? "medico" : null,
      cid, cidDescricao, cidNaoEncontrado,
      medico: certo("profissional", "Profissional"),
      crm: certo("registro", "CRM ou registro"),
      local: certo("local", "Hospital, clínica ou local"),
      emitidoEm,
      acompanhado: certo("acompanhado", "Acompanhado"),
      incertos,
    },
  };
}
