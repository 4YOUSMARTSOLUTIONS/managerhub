import { notFound } from "next/navigation";
import { exigirTelaBase } from "@/lib/module-gate";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { EditorDeArtigo } from "@/components/conhecimento/EditorDeArtigo";
import { assinarImagens, podeEscreverConhecimento } from "@/lib/conhecimento-servidor";
import { imagensDoConteudo } from "@/lib/conhecimento";

/** Só o Proprietário escreve no Banco de conhecimento (LUIZ, 18/11/2026). */
export default async function EditarArtigoPage({ params }: { params: Promise<{ slug: string }> }) {
  await exigirTelaBase("conhecimento");
  if (!(await podeEscreverConhecimento())) notFound();
  const { slug } = await params;
  const supabase = await createClient();
  const { data: a } = await supabase
    .from("conhecimento_artigos")
    .select("id, slug, modulo, titulo, resumo, conteudo, ordem, publicado, updated_at")
    .eq("slug", slug)
    .maybeSingle();
  if (!a) notFound();
  const imagens = await assinarImagens(imagensDoConteudo(a.conteudo));
  return (
    <div>
      <PageHeader title="Editar artigo" subtitle={a.titulo} />
      <EditorDeArtigo
        key={a.id}
        inicial={{
          id: a.id, slug: a.slug, modulo: a.modulo, titulo: a.titulo, resumo: a.resumo ?? "",
          conteudo: a.conteudo, ordem: a.ordem, publicado: a.publicado, versao: a.updated_at,
        }}
        imagens={imagens}
      />
    </div>
  );
}
