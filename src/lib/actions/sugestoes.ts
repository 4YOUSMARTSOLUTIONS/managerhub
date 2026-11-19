"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { recusaDeUpload } from "@/lib/uploads";
import { MODULE_BY_KEY } from "@/lib/modules";
import {
  BUCKET_SUGESTOES, MAX_PRINTS_SUGESTAO, MIMES_PRINT_SUGESTAO, TAMANHO_PRINT_SUGESTAO,
  type ComentarioSugestao, type SugestaoStatus,
} from "@/lib/sugestoes";

/**
 * Sugestões (LUIZ, 18/11/2026). O banco decide quem pode o quê (as RPCs
 * sugestao_* têm a guarda no corpo); aqui fica a validação que dá mensagem em
 * português antes da ida ao banco e a limpeza dos prints no armazenamento.
 */
const erro = (e: unknown) => ({ error: e instanceof Error ? e.message : "Não foi possível concluir." });
// a mensagem do banco já sai em português, escrita para quem usa a tela
const msg = (m: string) => m;

function validar(titulo: string, descricao: string, modulo: string | null): string | null {
  if (titulo.trim().length < 5) return "Escreva um título com pelo menos 5 letras.";
  if (titulo.trim().length > 120) return "O título passa de 120 letras.";
  if (descricao.trim().length < 10) return "Descreva a sugestão com um pouco mais de detalhe.";
  if (descricao.trim().length > 4000) return "A descrição passa de 4.000 letras.";
  if (modulo && !(modulo in MODULE_BY_KEY)) return "Tela desconhecida.";
  return null;
}

async function apagarPrints(supabase: Awaited<ReturnType<typeof actionContext>>["supabase"], arquivos: string[] | null) {
  if (!arquivos?.length) return;
  const { error } = await supabase.storage.from(BUCKET_SUGESTOES).remove(arquivos);
  if (error) console.error("[sugestoes] prints", error.message);
}

export async function criarSugestao(input: {
  titulo: string; descricao: string; modulo: string | null; imagens: string[];
}): Promise<{ error?: string; id?: string }> {
  try {
    const { supabase } = await actionContext();
    const recusa = validar(input.titulo, input.descricao, input.modulo);
    if (recusa) return { error: recusa };
    if (input.imagens.length > MAX_PRINTS_SUGESTAO) return { error: `Até ${MAX_PRINTS_SUGESTAO} prints por sugestão.` };
    const { data, error } = await supabase.rpc("sugestao_criar", {
      p_titulo: input.titulo, p_descricao: input.descricao, p_modulo: input.modulo, p_imagens: input.imagens,
    });
    if (error) return { error: msg(error.message) };
    revalidatePath("/sugestoes");
    return { id: data as string };
  } catch (e) { return erro(e); }
}

export async function editarSugestao(input: {
  id: string; titulo: string; descricao: string; modulo: string | null; imagens: string[];
}): Promise<{ error?: string }> {
  try {
    const { supabase } = await actionContext();
    const recusa = validar(input.titulo, input.descricao, input.modulo);
    if (recusa) return { error: recusa };
    const { data, error } = await supabase.rpc("sugestao_editar", {
      p_id: input.id, p_titulo: input.titulo, p_descricao: input.descricao, p_modulo: input.modulo, p_imagens: input.imagens,
    });
    if (error) return { error: msg(error.message) };
    await apagarPrints(supabase, data as string[]);
    revalidatePath("/sugestoes");
    return {};
  } catch (e) { return erro(e); }
}

export async function apagarSugestao(id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.rpc("sugestao_apagar", { p_id: id });
    if (error) return { error: msg(error.message) };
    await apagarPrints(supabase, data as string[]);
    revalidatePath("/sugestoes");
    return {};
  } catch (e) { return erro(e); }
}

export async function curtirSugestao(id: string, curtir: boolean): Promise<{ error?: string; curtidas?: number }> {
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.rpc("sugestao_curtir", { p_id: id, p_curtir: curtir });
    if (error) return { error: msg(error.message) };
    revalidatePath("/sugestoes");
    return { curtidas: data as number };
  } catch (e) { return erro(e); }
}

export async function seguirSugestao(id: string, segue: boolean): Promise<{ error?: string }> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("sugestao_seguir", { p_id: id, p_segue: segue });
    if (error) return { error: msg(error.message) };
    revalidatePath("/sugestoes");
    return {};
  } catch (e) { return erro(e); }
}

export async function comentarSugestao(id: string, texto: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await actionContext();
    if (!texto.trim()) return { error: "Escreva o comentário." };
    if (texto.trim().length > 2000) return { error: "O comentário passa de 2.000 letras." };
    const { error } = await supabase.rpc("sugestao_comentar", { p_id: id, p_texto: texto });
    if (error) return { error: msg(error.message) };
    revalidatePath("/sugestoes");
    return {};
  } catch (e) { return erro(e); }
}

export async function editarComentarioSugestao(id: string, texto: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await actionContext();
    if (!texto.trim()) return { error: "Escreva o comentário." };
    if (texto.trim().length > 2000) return { error: "O comentário passa de 2.000 letras." };
    const { error } = await supabase.rpc("sugestao_editar_comentario", { p_id: id, p_texto: texto });
    if (error) return { error: msg(error.message) };
    return {};
  } catch (e) { return erro(e); }
}

export async function apagarComentarioSugestao(id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("sugestao_apagar_comentario", { p_id: id });
    if (error) return { error: msg(error.message) };
    revalidatePath("/sugestoes");
    return {};
  } catch (e) { return erro(e); }
}

export async function moderarComentarioSugestao(id: string, ocultar: boolean): Promise<{ error?: string }> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("sugestao_moderar_comentario", { p_id: id, p_ocultar: ocultar });
    if (error) return { error: msg(error.message) };
    revalidatePath("/sugestoes");
    return {};
  } catch (e) { return erro(e); }
}

export async function triarSugestao(input: {
  id: string; status: SugestaoStatus; resposta: string; duplicadaDe: string | null; artigoSlug: string | null;
}): Promise<{ error?: string }> {
  try {
    const { supabase } = await actionContext();
    if (input.status === "recusada" && !input.resposta.trim()) return { error: "Escreva na resposta o motivo da recusa." };
    if (input.status === "duplicada" && !input.duplicadaDe) return { error: "Escolha a sugestão original." };
    const { error } = await supabase.rpc("sugestao_triar", {
      p_id: input.id, p_status: input.status, p_resposta: input.resposta || null,
      p_duplicada_de: input.status === "duplicada" ? input.duplicadaDe : null,
      p_artigo_slug: input.artigoSlug || null,
    });
    if (error) return { error: msg(error.message) };
    revalidatePath("/sugestoes");
    return {};
  } catch (e) { return erro(e); }
}

export async function moderarSugestao(id: string, ocultar: boolean, motivo: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("sugestao_moderar", { p_id: id, p_ocultar: ocultar, p_motivo: motivo || null });
    if (error) return { error: msg(error.message) };
    revalidatePath("/sugestoes");
    return {};
  } catch (e) { return erro(e); }
}

/** Sobe um print na pasta da própria pessoa e devolve o arquivo e o link para a prévia. */
export async function enviarPrintSugestao(formData: FormData): Promise<{ error?: string; arquivo?: string; url?: string }> {
  try {
    const { supabase, userId } = await actionContext();
    const file = formData.get("file");
    if (!(file instanceof File)) return { error: "Escolha a imagem." };
    const recusa = recusaDeUpload(file, TAMANHO_PRINT_SUGESTAO, MIMES_PRINT_SUGESTAO);
    if (recusa) return { error: recusa };
    const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[
      (file.type || "").toLowerCase()
    ] ?? "png";
    const arquivo = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET_SUGESTOES)
      .upload(arquivo, file, { contentType: file.type || "image/png", upsert: false });
    if (error) return { error: error.message };
    const { data } = await supabase.storage.from(BUCKET_SUGESTOES).createSignedUrl(arquivo, 3600);
    return { arquivo, url: data?.signedUrl };
  } catch (e) { return erro(e); }
}

/** Print enviado e depois tirado do formulário antes de salvar. */
export async function descartarPrintSugestao(arquivo: string): Promise<{ error?: string }> {
  try {
    const { supabase, userId } = await actionContext();
    if (!arquivo.startsWith(`${userId}/`)) return { error: "Imagem inválida." };
    await apagarPrints(supabase, [arquivo]);
    return {};
  } catch (e) { return erro(e); }
}

/** O que a ficha carrega ao abrir: comentários, quem curtiu e os links dos prints. */
export async function lerFichaSugestao(id: string, imagens: string[]): Promise<{
  error?: string;
  comentarios?: ComentarioSugestao[];
  curtidores?: { nome: string; empresa: string }[];
  urls?: Record<string, string>;
}> {
  try {
    const { supabase } = await actionContext();
    const [{ data: cs, error: e1 }, { data: ls, error: e2 }, assinadas] = await Promise.all([
      supabase.from("sugestao_comentarios")
        .select("id, autor_id, autor_nome, empresa_nome, texto, oculto, editado_em, created_at")
        .eq("sugestao_id", id).order("created_at"),
      supabase.from("sugestao_curtidas").select("user_nome, empresa_nome, created_at")
        .eq("sugestao_id", id).order("created_at"),
      imagens.length
        ? supabase.storage.from(BUCKET_SUGESTOES).createSignedUrls(imagens, 3600)
        : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
    ]);
    if (e1 || e2) return { error: (e1 ?? e2)?.message };
    const urls: Record<string, string> = {};
    for (const d of assinadas.data ?? []) if (d.path && d.signedUrl) urls[d.path] = d.signedUrl;
    return {
      comentarios: (cs ?? []).map((c) => ({
        id: c.id, autorId: c.autor_id, autorNome: c.autor_nome, empresaNome: c.empresa_nome,
        texto: c.texto, oculto: c.oculto, editadoEm: c.editado_em, createdAt: c.created_at,
      })),
      curtidores: (ls ?? []).map((l) => ({ nome: l.user_nome, empresa: l.empresa_nome })),
      urls,
    };
  } catch (e) { return erro(e); }
}
