"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { getIsSuperAdmin } from "@/lib/auth-cache";
import { MODULE_BY_KEY, type ModuleKey } from "@/lib/modules";
import { recusaDeUpload } from "@/lib/uploads";
import {
  BUCKET_CONHECIMENTO, MIMES_IMAGEM_CONHECIMENTO, SLUG_VALIDO, TAMANHO_IMAGEM_CONHECIMENTO,
} from "@/lib/conhecimento";

/**
 * Escrita do Banco de conhecimento: só o dono da plataforma (LUIZ, 18/11/2026).
 * A RLS e as políticas do bucket conferem de novo; a checagem aqui é para a
 * mensagem sair em português antes de qualquer ida ao banco.
 */
async function soDonoDaPlataforma() {
  const ctx = await actionContext();
  if (!(await getIsSuperAdmin())) throw new Error("Só o proprietário da plataforma edita o Banco de conhecimento.");
  return ctx;
}

const erro = (e: unknown) => ({ error: e instanceof Error ? e.message : "Não foi possível concluir." });

export async function salvarArtigo(input: {
  id: string | null;
  slug: string;
  modulo: string | null;
  titulo: string;
  resumo: string;
  conteudo: string;
  ordem: number;
  publicado: boolean;
}): Promise<{ error?: string; id?: string; slug?: string }> {
  try {
    const { supabase } = await soDonoDaPlataforma();
    const titulo = input.titulo.trim();
    const slug = input.slug.trim();
    if (!titulo) return { error: "Informe o título." };
    if (!SLUG_VALIDO.test(slug) || slug === "novo") {
      return { error: "Endereço inválido: use letras minúsculas, números e hífen (ex.: absenteismo)." };
    }
    const modulo = input.modulo && input.modulo in MODULE_BY_KEY ? (input.modulo as ModuleKey) : null;
    if (input.modulo && !modulo) return { error: "Módulo desconhecido." };
    const linha = {
      slug,
      modulo,
      titulo,
      resumo: input.resumo.trim() || null,
      conteudo: input.conteudo,
      ordem: Number.isFinite(input.ordem) ? Math.trunc(input.ordem) : 0,
      publicado: input.publicado,
    };

    const r = input.id
      ? await supabase.from("conhecimento_artigos").update(linha).eq("id", input.id).select("id, slug").maybeSingle()
      : await supabase.from("conhecimento_artigos").insert(linha).select("id, slug").maybeSingle();
    if (r.error) {
      if (r.error.code === "23505") return { error: `Já existe um artigo no endereço "${slug}".` };
      return { error: r.error.message };
    }
    if (!r.data) return { error: "Artigo não encontrado." };

    revalidatePath("/conhecimento");
    revalidatePath(`/conhecimento/${r.data.slug}`);
    return { id: r.data.id, slug: r.data.slug };
  } catch (e) {
    return erro(e);
  }
}

export async function apagarArtigo(id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await soDonoDaPlataforma();
    const { data, error } = await supabase.from("conhecimento_artigos").delete().eq("id", id).select("conteudo").maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "Artigo não encontrado." };
    revalidatePath("/conhecimento");
    return {};
  } catch (e) {
    return erro(e);
  }
}

/** Sobe um print para o artigo e devolve o arquivo e o link para a prévia. */
export async function enviarImagemConhecimento(formData: FormData): Promise<{ error?: string; arquivo?: string; url?: string }> {
  try {
    const { supabase } = await soDonoDaPlataforma();
    const file = formData.get("file");
    if (!(file instanceof File)) return { error: "Escolha a imagem." };
    const recusa = recusaDeUpload(file, TAMANHO_IMAGEM_CONHECIMENTO, MIMES_IMAGEM_CONHECIMENTO);
    if (recusa) return { error: recusa };

    const extensao = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[
      (file.type || "").toLowerCase()
    ] ?? "png";
    const arquivo = `${crypto.randomUUID()}.${extensao}`;
    const { error: e1 } = await supabase.storage
      .from(BUCKET_CONHECIMENTO)
      .upload(arquivo, file, { contentType: file.type || "image/png", upsert: false });
    if (e1) return { error: e1.message };

    const { data } = await supabase.storage.from(BUCKET_CONHECIMENTO).createSignedUrl(arquivo, 3600);
    return { arquivo, url: data?.signedUrl };
  } catch (e) {
    return erro(e);
  }
}
