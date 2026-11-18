import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { exigirTelaBase } from "@/lib/module-gate";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListaDeArtigos, type CartaoDeArtigo } from "@/components/conhecimento/ListaDeArtigos";
import { quemVeArtigo } from "@/lib/conhecimento-servidor";
import { textoParaBusca } from "@/lib/conhecimento";
import { MODULE_BY_KEY, MODULE_GROUPS, type ModuleKey } from "@/lib/modules";

/**
 * Banco de conhecimento (LUIZ, 18/11/2026): o manual de cada módulo, escrito
 * pelo dono da plataforma e igual para todas as empresas. Cada pessoa vê os
 * artigos dos módulos que acessa.
 */
export default async function ConhecimentoPage() {
  await exigirTelaBase("conhecimento");
  const { isSuperAdmin } = await requireContext();
  const supabase = await createClient();

  const [{ data }, ve] = await Promise.all([
    supabase
      .from("conhecimento_artigos")
      .select("id, slug, modulo, titulo, resumo, conteudo, ordem, publicado, updated_at")
      .order("ordem")
      .order("titulo"),
    quemVeArtigo(),
  ]);

  const grupoDe = new Map(MODULE_GROUPS.map((g) => [g.key, g.label]));
  const artigos: CartaoDeArtigo[] = (data ?? [])
    .filter((a) => ve(a.modulo))
    .map((a) => {
      const m = a.modulo ? MODULE_BY_KEY[a.modulo as ModuleKey] : null;
      return {
        id: a.id,
        slug: a.slug,
        titulo: a.titulo,
        resumo: a.resumo,
        publicado: a.publicado,
        updatedAt: a.updated_at,
        modulo: m?.label ?? null,
        // a seção segue o menu: o grupo do módulo, ou o próprio módulo solto
        secao: m ? (m.group ? grupoDe.get(m.group) ?? m.label : m.label) : "Geral",
        busca: `${a.titulo} ${a.resumo ?? ""} ${m?.label ?? ""} ${textoParaBusca(a.conteudo)}`,
      };
    });

  return (
    <div>
      <PageHeader
        title="Banco de conhecimento"
        subtitle="Como funciona e como usar cada tela do portal"
        action={isSuperAdmin ? (
          <Link href="/conhecimento/novo" className="btn btn-primary btn-sm">
            <Plus size={15} /> Novo artigo
          </Link>
        ) : undefined}
      />
      {artigos.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={24} />}
          title="Nenhum artigo por aqui ainda"
          description="Os manuais aparecem aqui conforme forem publicados, para as telas que você usa."
        />
      ) : (
        <ListaDeArtigos artigos={artigos} />
      )}
    </div>
  );
}
