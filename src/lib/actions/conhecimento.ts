"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { getIsSuperAdmin } from "@/lib/auth-cache";
import { MODULE_BY_KEY, type ModuleKey } from "@/lib/modules";
import { recusaDeUpload } from "@/lib/uploads";
import {
  BUCKET_CONHECIMENTO, MIMES_IMAGEM_CONHECIMENTO, SLUG_VALIDO, TAMANHO_IMAGEM_CONHECIMENTO, imagensDoConteudo,
} from "@/lib/conhecimento";

/**
 * Escrita do Banco de conhecimento: o perfil Proprietário (LUIZ, 18/11/2026) e
 * o dono da plataforma. A RLS e as políticas do bucket conferem de novo
 * (`pode_escrever_conhecimento`); a checagem aqui é para a mensagem sair em
 * português antes de qualquer ida ao banco.
 */
async function soQuemEscreve() {
  const ctx = await actionContext();
  if (ctx.role !== "owner" && !(await getIsSuperAdmin())) {
    throw new Error("Só o proprietário edita o Banco de conhecimento.");
  }
  return ctx;
}

const erro = (e: unknown) => ({ error: e instanceof Error ? e.message : "Não foi possível concluir." });

type Cliente = Awaited<ReturnType<typeof actionContext>>["supabase"];

/**
 * Imagem que saiu do texto é apagada do armazenamento (LUIZ, 18/11/2026: os
 * prints refeitos deixavam os antigos órfãos). Só a que nenhum outro artigo
 * usa; falha aqui não desfaz o que já foi salvo.
 */
async function apagarImagensQueSairam(supabase: Cliente, artigoId: string, sairam: string[]) {
  if (!sairam.length) return;
  const { data: outros } = await supabase.from("conhecimento_artigos").select("conteudo").neq("id", artigoId);
  const emUso = new Set((outros ?? []).flatMap((o) => imagensDoConteudo(o.conteudo)));
  const apagar = sairam.filter((a) => !emUso.has(a));
  if (!apagar.length) return;
  const { error } = await supabase.storage.from(BUCKET_CONHECIMENTO).remove(apagar);
  if (error) console.error("[conhecimento] imagens que saíram", error.message);
}

export async function salvarArtigo(input: {
  id: string | null;
  slug: string;
  modulo: string | null;
  titulo: string;
  resumo: string;
  conteudo: string;
  ordem: number;
  publicado: boolean;
  /** `updated_at` de quando o editor abriu; obrigatório para atualizar */
  versao: string | null;
}): Promise<{ error?: string; id?: string; slug?: string; versao?: string }> {
  try {
    const { supabase } = await soQuemEscreve();
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

    // as imagens de antes, para apagar as que saírem do texto
    const antes = input.id
      ? imagensDoConteudo((await supabase.from("conhecimento_artigos").select("conteudo").eq("id", input.id).maybeSingle()).data?.conteudo ?? "")
      : [];

    // Só grava sobre a versão que o editor abriu (LUIZ editava numa aba enquanto
    // os prints eram refeitos na outra): sem isso, a aba antiga apagava o que a
    // nova salvou, e a limpeza de imagens levaria as novas junto.
    if (input.id && !input.versao) return { error: "Recarregue a página antes de salvar." };
    const r = input.id
      ? await supabase.from("conhecimento_artigos").update(linha)
          .eq("id", input.id).eq("updated_at", input.versao as string)
          .select("id, slug, updated_at").maybeSingle()
      : await supabase.from("conhecimento_artigos").insert(linha).select("id, slug, updated_at").maybeSingle();
    if (r.error) {
      if (r.error.code === "23505") return { error: `Já existe um artigo no endereço "${slug}".` };
      return { error: r.error.message };
    }
    if (!r.data) {
      if (input.id) {
        const { data: existe } = await supabase.from("conhecimento_artigos").select("id").eq("id", input.id).maybeSingle();
        if (existe) {
          return { error: "Este artigo foi alterado depois que o editor foi aberto (em outra aba ou por outra pessoa). Copie o que escreveu, recarregue a página e salve de novo." };
        }
      }
      return { error: "Artigo não encontrado." };
    }

    const agora = new Set(imagensDoConteudo(input.conteudo));
    await apagarImagensQueSairam(supabase, r.data.id, antes.filter((a) => !agora.has(a)));

    revalidatePath("/conhecimento");
    revalidatePath(`/conhecimento/${r.data.slug}`);
    return { id: r.data.id, slug: r.data.slug, versao: r.data.updated_at };
  } catch (e) {
    return erro(e);
  }
}

export async function apagarArtigo(id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await soQuemEscreve();
    const { data, error } = await supabase.from("conhecimento_artigos").delete().eq("id", id).select("conteudo").maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "Artigo não encontrado." };
    await apagarImagensQueSairam(supabase, id, imagensDoConteudo(data.conteudo));
    revalidatePath("/conhecimento");
    return {};
  } catch (e) {
    return erro(e);
  }
}

/** Sobe um print para o artigo e devolve o arquivo e o link para a prévia. */
export async function enviarImagemConhecimento(formData: FormData): Promise<{ error?: string; arquivo?: string; url?: string }> {
  try {
    const { supabase } = await soQuemEscreve();
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
