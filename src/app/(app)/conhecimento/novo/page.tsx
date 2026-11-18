import { notFound } from "next/navigation";
import { exigirTelaBase } from "@/lib/module-gate";
import { PageHeader } from "@/components/ui/PageHeader";
import { EditorDeArtigo } from "@/components/conhecimento/EditorDeArtigo";
import { podeEscreverConhecimento } from "@/lib/conhecimento-servidor";

/** Só o Proprietário escreve no Banco de conhecimento (LUIZ, 18/11/2026). */
export default async function NovoArtigoPage() {
  await exigirTelaBase("conhecimento");
  if (!(await podeEscreverConhecimento())) notFound();
  return (
    <div>
      <PageHeader title="Novo artigo" subtitle="Banco de conhecimento" />
      <EditorDeArtigo inicial={null} imagens={{}} />
    </div>
  );
}
