"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionContext } from "./context";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  BUCKET_FORMULARIOS, COLUNAS_FORMULARIO, ORDEM_TIPOS, TAMANHO_ARQUIVO_FORMULARIO,
  arquivosDasRespostas, formularioDaLinha, respostasParaEnviar, validarRespostas,
  type Campo, type Respostas, type TipoCampo,
} from "@/lib/formularios";

/**
 * Formulários (LUIZ, 24/11/2026). O banco decide quem pode o quê (as funções
 * formulario_* têm a guarda no corpo); aqui fica a validação que dá mensagem em
 * português antes da ida ao banco, e o armazenamento dos arquivos.
 *
 * O bucket `formularios` não tem policy para o cliente: a subida e a leitura são
 * assinadas com a chave de serviço DEPOIS de o banco autorizar a pessoa
 * (`formulario_pode_enviar` para subir, a RLS da resposta para ler). Assim o
 * caminho do arquivo nunca carrega quem enviou, o que desfaria o anonimato.
 */

type Resultado<T = object> = Promise<{ error?: string } & Partial<T>>;
const erro = (e: unknown) => ({ error: e instanceof Error ? e.message : "Não foi possível concluir." });

const TIPOS_VALIDOS = new Set<string>(ORDEM_TIPOS);
const texto = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const lista = (v: unknown, maxItens: number, maxTexto = 200) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, maxItens).map((x: string) => x.slice(0, maxTexto)) : [];
const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const inteiroEntre = (v: unknown, min: number, max: number, padrao: number) => {
  const n = numero(v);
  return n === null ? padrao : Math.min(max, Math.max(min, Math.round(n)));
};

/** Só o que o editor pode gravar: tipo conhecido, textos e listas com teto. */
function sanitizarCampos(entrada: unknown): Campo[] {
  if (!Array.isArray(entrada)) throw new Error("Perguntas inválidas.");
  if (entrada.length > 300) throw new Error("O formulário passa de 300 perguntas.");
  return entrada.map((bruto) => {
    const c = (bruto ?? {}) as Record<string, unknown>;
    const tipo = String(c.tipo ?? "") as TipoCampo;
    if (!TIPOS_VALIDOS.has(tipo)) throw new Error("Tipo de pergunta desconhecido.");
    const id = texto(c.id, 40);
    if (!id) throw new Error("Perguntas inválidas.");
    const saida: Campo = { id, tipo, titulo: texto(c.titulo, 500) };
    const descricao = texto(c.descricao, 2000);
    if (descricao) saida.descricao = descricao;
    if (c.obrigatorio === true) saida.obrigatorio = true;
    if (c.removido === true) saida.removido = true;
    const cond = c.condicao as { campo?: unknown; valores?: unknown } | null | undefined;
    if (cond && typeof cond.campo === "string" && cond.campo) {
      const valores = lista(cond.valores, 100);
      if (valores.length) saida.condicao = { campo: cond.campo.slice(0, 40), valores };
    }
    switch (tipo) {
      case "multipla_escolha":
      case "caixas_selecao":
      case "lista_suspensa":
      case "ranking":
        saida.opcoes = lista(c.opcoes, 100);
        if (tipo !== "ranking" && c.embaralhar === true) saida.embaralhar = true;
        if ((tipo === "multipla_escolha" || tipo === "caixas_selecao") && c.outro === true) saida.outro = true;
        if (tipo === "caixas_selecao") {
          saida.minSel = numero(c.minSel);
          saida.maxSel = numero(c.maxSel);
        }
        break;
      case "texto_curto":
        saida.formato = (["livre", "email", "telefone", "link"] as const).find((f) => f === c.formato) ?? "livre";
        saida.maxCaracteres = numero(c.maxCaracteres);
        break;
      case "paragrafo":
        saida.maxCaracteres = numero(c.maxCaracteres);
        break;
      case "numero":
        saida.min = numero(c.min);
        saida.max = numero(c.max);
        if (c.inteiro === true) saida.inteiro = true;
        break;
      case "escala":
        saida.escalaMin = c.escalaMin === 0 ? 0 : 1;
        saida.escalaMax = inteiroEntre(c.escalaMax, 2, 10, 5);
        saida.rotuloMin = texto(c.rotuloMin, 60);
        saida.rotuloMax = texto(c.rotuloMax, 60);
        break;
      case "nps":
        saida.rotuloMin = texto(c.rotuloMin, 60);
        saida.rotuloMax = texto(c.rotuloMax, 60);
        break;
      case "avaliacao":
        saida.estrelas = inteiroEntre(c.estrelas, 3, 10, 5);
        break;
      case "grade_multipla":
      case "grade_caixas":
        saida.linhas = lista(c.linhas, 40);
        saida.colunas = lista(c.colunas, 15);
        break;
      case "fotos":
        saida.maxArquivos = inteiroEntre(c.maxArquivos, 1, 10, 5);
        break;
      case "arquivos":
        saida.maxArquivos = inteiroEntre(c.maxArquivos, 1, 10, 3);
        break;
    }
    return saida;
  });
}

export type DadosFormulario = {
  titulo: string;
  descricao: string;
  campos: Campo[];
  anonimo: boolean;
  privado: boolean;
  variasRespostas: boolean;
  permiteEditar: boolean;
  prazo: string | null;
  mensagemFinal: string;
  publicoTodos: boolean;
  publicoNiveis: string[];
  publicoCargos: string[];
  publicoPessoas: string[];
  unidades: string[];
};

/**
 * Cria o rascunho e já abre o editor NA MESMA resposta.
 *
 * Antes devolvia o id e a tela fazia `router.push`: eram duas idas ao servidor, e
 * a primeira ainda redesenhava a lista inteira por causa do `revalidatePath`,
 * para ser descartada logo em seguida (0,5 a 0,8 s jogados fora). Com `redirect`
 * o Next desenha o editor dentro da própria resposta da action.
 *
 * `redirect` lança o controle de fluxo do Next, então fica FORA do try: dentro,
 * o `catch` o engoliria como erro. Só volta valor quando dá errado.
 */
export async function criarFormulario(): Promise<{ error: string }> {
  let id: string;
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.rpc("formulario_criar");
    if (error) return { error: error.message };
    id = data as string;
  } catch (e) { return { error: erro(e).error }; }
  revalidatePath("/formularios");
  redirect(`/formularios/${id}/editar`);
}

export async function salvarFormulario(id: string, d: DadosFormulario): Resultado {
  try {
    const { supabase } = await actionContext();
    if (!d.titulo.trim()) return { error: "Dê um título ao formulário." };
    if (d.prazo && Number.isNaN(new Date(d.prazo).getTime())) return { error: "Prazo inválido." };
    const campos = sanitizarCampos(d.campos);
    const { error } = await supabase.rpc("formulario_salvar", {
      p_id: id,
      p_dados: {
        titulo: d.titulo.trim().slice(0, 150),
        descricao: d.descricao.slice(0, 4000),
        campos,
        anonimo: d.anonimo,
        privado: d.privado,
        varias_respostas: d.variasRespostas,
        permite_editar: d.permiteEditar,
        prazo: d.prazo,
        mensagem_final: d.mensagemFinal.slice(0, 1000),
        publico_todos: d.publicoTodos,
        publico_niveis: d.publicoNiveis,
        publico_cargos: d.publicoCargos,
        publico_pessoas: d.publicoPessoas,
        unidades: d.unidades,
      },
    });
    if (error) return { error: error.message };
    revalidatePath("/formularios");
    return {};
  } catch (e) { return erro(e); }
}

export async function publicarFormulario(id: string): Resultado<{ avisados: number }> {
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.rpc("formulario_publicar", { p_id: id });
    if (error) return { error: error.message };
    revalidatePath("/formularios");
    return { avisados: (data as number) ?? 0 };
  } catch (e) { return erro(e); }
}

export async function encerrarFormulario(id: string): Resultado {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("formulario_encerrar", { p_id: id });
    if (error) return { error: error.message };
    revalidatePath("/formularios");
    return {};
  } catch (e) { return erro(e); }
}

/** Mesmo caminho de `criarFormulario`: a cópia abre no editor na mesma resposta. */
export async function duplicarFormulario(id: string): Promise<{ error: string }> {
  let novo: string;
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.rpc("formulario_duplicar", { p_id: id });
    if (error) return { error: error.message };
    novo = data as string;
  } catch (e) { return { error: erro(e).error }; }
  revalidatePath("/formularios");
  redirect(`/formularios/${novo}/editar`);
}

/** Tira do bucket os arquivos citados e tudo o que ficou na pasta do formulário. */
async function limparPasta(tenantId: string, formId: string, citados: string[]) {
  try {
    const admin = createServiceClient();
    const pasta = `${tenantId}/${formId}`;
    const todos = new Set(citados.filter((p) => p.startsWith(`${pasta}/`)));
    // fotos enviadas e não usadas (a pessoa desistiu antes de enviar) também saem
    for (let pagina = 0; pagina < 50; pagina++) {
      const { data, error } = await admin.storage.from(BUCKET_FORMULARIOS).list(pasta, { limit: 1000, offset: pagina * 1000 });
      if (error || !data?.length) break;
      for (const o of data) todos.add(`${pasta}/${o.name}`);
      if (data.length < 1000) break;
    }
    const lista = [...todos];
    for (let i = 0; i < lista.length; i += 500) {
      const { error } = await admin.storage.from(BUCKET_FORMULARIOS).remove(lista.slice(i, i + 500));
      if (error) console.error("[formularios] limpar pasta", error.message);
    }
  } catch (e) {
    console.error("[formularios] limpar pasta", e instanceof Error ? e.message : e);
  }
}

async function apagarArquivos(paths: string[]) {
  if (!paths.length) return;
  try {
    const { error } = await createServiceClient().storage.from(BUCKET_FORMULARIOS).remove(paths);
    if (error) console.error("[formularios] apagar arquivos", error.message);
  } catch (e) {
    console.error("[formularios] apagar arquivos", e instanceof Error ? e.message : e);
  }
}

export async function apagarFormulario(id: string): Resultado {
  try {
    const { supabase } = await actionContext();
    const { data: f } = await supabase.from("formularios").select("tenant_id").eq("id", id).maybeSingle();
    const { data, error } = await supabase.rpc("formulario_apagar", { p_id: id });
    if (error) return { error: error.message };
    if (f?.tenant_id) await limparPasta(f.tenant_id, id, (data as string[] | null) ?? []);
    revalidatePath("/formularios");
    return {};
  } catch (e) { return erro(e); }
}

const EXTENSOES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt", "text/csv": "csv",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/webm": "weba", "audio/ogg": "ogg",
  "audio/wav": "wav", "audio/x-m4a": "m4a",
};

/**
 * Autoriza a subida de um arquivo e devolve o endereço assinado. O navegador sobe
 * direto para o Storage: pela action, um arquivo acima de 4,5 MB morreria no
 * limite de corpo da Vercel.
 */
export async function autorizarArquivoFormulario(input: {
  formId: string; tipo: string; tamanho: number;
}): Resultado<{ path: string; token: string }> {
  try {
    const { supabase } = await actionContext();
    const tipo = (input.tipo || "").split(";")[0].trim().toLowerCase();
    const ext = EXTENSOES[tipo];
    if (!ext) return { error: "Tipo de arquivo não aceito." };
    if (!(input.tamanho > 0)) return { error: "O arquivo está vazio." };
    if (input.tamanho > TAMANHO_ARQUIVO_FORMULARIO) return { error: "O arquivo passa de 20 MB." };
    const { data: tenant, error } = await supabase.rpc("formulario_pode_enviar", { p_form: input.formId });
    if (error) return { error: error.message };
    if (!tenant) return { error: "Este formulário não está recebendo respostas." };
    const path = `${tenant}/${input.formId}/${crypto.randomUUID()}.${ext}`;
    const { data, error: e2 } = await createServiceClient().storage.from(BUCKET_FORMULARIOS).createSignedUploadUrl(path);
    if (e2 || !data) return { error: e2?.message ?? "Não foi possível iniciar o envio." };
    return { path: data.path, token: data.token };
  } catch (e) { return erro(e); }
}

/** Lê o formulário pela RLS (só chega se a pessoa pode vê-lo) e confere as respostas. */
async function conferir(supabase: Awaited<ReturnType<typeof actionContext>>["supabase"], formId: string, respostas: Respostas) {
  const { data: linha, error } = await supabase.from("formularios").select(COLUNAS_FORMULARIO).eq("id", formId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!linha) throw new Error("Formulário não encontrado.");
  const f = formularioDaLinha(linha as unknown as Parameters<typeof formularioDaLinha>[0]);
  const campos = f.campos.filter((c) => !c.removido);
  const erros = validarRespostas(campos, respostas);
  const primeiro = Object.keys(erros)[0];
  if (primeiro) {
    const c = campos.find((x) => x.id === primeiro);
    throw new Error(`${c?.titulo || "Pergunta"}: ${erros[primeiro]}`);
  }
  const limpas = respostasParaEnviar(campos, respostas);
  const arquivos = arquivosDasRespostas(campos, limpas);
  const prefixo = `${f.tenantId}/${f.id}/`;
  if (arquivos.some((p) => !p.startsWith(prefixo))) throw new Error("Arquivo inválido.");
  return { f, limpas, arquivos };
}

export async function enviarResposta(formId: string, respostas: Respostas): Resultado<{ id: string }> {
  try {
    const { supabase } = await actionContext();
    const { limpas, arquivos } = await conferir(supabase, formId, respostas);
    const { data, error } = await supabase.rpc("formulario_responder", {
      p_form: formId, p_respostas: limpas, p_arquivos: arquivos,
    });
    if (error) return { error: error.message };
    revalidatePath("/formularios");
    return { id: data as string };
  } catch (e) { return erro(e); }
}

export async function editarResposta(respostaId: string, respostas: Respostas): Resultado {
  try {
    const { supabase } = await actionContext();
    const { data: r } = await supabase.from("formulario_respostas").select("formulario_id").eq("id", respostaId).maybeSingle();
    if (!r) return { error: "Resposta não encontrada." };
    const { limpas, arquivos } = await conferir(supabase, r.formulario_id, respostas);
    const { data, error } = await supabase.rpc("formulario_editar_resposta", {
      p_resposta: respostaId, p_respostas: limpas, p_arquivos: arquivos,
    });
    if (error) return { error: error.message };
    await apagarArquivos((data as string[] | null) ?? []);
    revalidatePath("/formularios");
    return {};
  } catch (e) { return erro(e); }
}

export async function apagarResposta(respostaId: string): Resultado {
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.rpc("formulario_apagar_resposta", { p_resposta: respostaId });
    if (error) return { error: error.message };
    await apagarArquivos((data as string[] | null) ?? []);
    revalidatePath("/formularios");
    return {};
  } catch (e) { return erro(e); }
}

/** Links de leitura (1 hora) dos arquivos de uma resposta que a pessoa pode ver. */
export async function linksDaResposta(respostaId: string): Resultado<{ urls: Record<string, string> }> {
  try {
    const { supabase } = await actionContext();
    const { data: r, error } = await supabase
      .from("formulario_respostas").select("arquivos, tenant_id, formulario_id").eq("id", respostaId).maybeSingle();
    if (error) return { error: error.message };
    if (!r) return { error: "Resposta não encontrada." };
    const prefixo = `${r.tenant_id}/${r.formulario_id}/`;
    const paths = (r.arquivos ?? []).filter((p: string) => p.startsWith(prefixo));
    if (!paths.length) return { urls: {} };
    const { data } = await createServiceClient().storage.from(BUCKET_FORMULARIOS).createSignedUrls(paths, 3600);
    const urls: Record<string, string> = {};
    for (const d of data ?? []) if (d.path && d.signedUrl) urls[d.path] = d.signedUrl;
    return { urls };
  } catch (e) { return erro(e); }
}

/** Links dos arquivos que a própria pessoa acabou de subir (prévia antes de enviar). */
export async function linkDoArquivoEnviado(formId: string, path: string): Resultado<{ url: string }> {
  try {
    const { supabase } = await actionContext();
    const { data: tenant } = await supabase.rpc("formulario_pode_enviar", { p_form: formId });
    if (!tenant || !path.startsWith(`${tenant}/${formId}/`)) return { error: "Arquivo inválido." };
    const { data } = await createServiceClient().storage.from(BUCKET_FORMULARIOS).createSignedUrl(path, 3600);
    return data?.signedUrl ? { url: data.signedUrl } : { error: "Arquivo não encontrado." };
  } catch (e) { return erro(e); }
}

export async function lerPendentes(formId: string): Resultado<{ pessoas: { id: string; nome: string }[] }> {
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.rpc("formulario_pendentes", { p_form: formId });
    if (error) return { error: error.message };
    return { pessoas: (data as { id: string; nome: string }[] | null) ?? [] };
  } catch (e) { return erro(e); }
}
