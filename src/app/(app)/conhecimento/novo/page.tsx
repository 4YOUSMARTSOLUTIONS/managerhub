import { notFound } from "next/navigation";
import { requireContext } from "@/lib/tenant";
import { exigirTelaBase } from "@/lib/module-gate";
import { PageHeader } from "@/components/ui/PageHeader";
import { EditorDeArtigo } from "@/components/conhecimento/EditorDeArtigo";

/** Só o dono da plataforma escreve no Banco de conhecimento (LUIZ, 18/11/2026). */
export default async function NovoArtigoPage() {
  await exigirTelaBase("conhecimento");
  const { isSuperAdmin } = await requireContext();
  if (!isSuperAdmin) notFound();
  return (
    <div>
      <PageHeader title="Novo artigo" subtitle="Banco de conhecimento" />
      <EditorDeArtigo inicial={null} imagens={{}} />
    </div>
  );
}
