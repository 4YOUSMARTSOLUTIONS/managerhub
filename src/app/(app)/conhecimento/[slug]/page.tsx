import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Pencil } from "lucide-react";
import { exigirTelaBase } from "@/lib/module-gate";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Markdown } from "@/components/conhecimento/Markdown";
import { assinarImagens, podeEscreverConhecimento, quemVeArtigo } from "@/lib/conhecimento-servidor";
import { imagensDoConteudo, sumario } from "@/lib/conhecimento";
import { MODULE_BY_KEY, type ModuleKey } from "@/lib/modules";
import { formatDate } from "@/lib/format";

export default async function ArtigoPage({ params }: { params: Promise<{ slug: string }> }) {
  await exigirTelaBase("conhecimento");
  const { slug } = await params;
  const supabase = await createClient();

  const [{ data: artigo }, ve, escreve] = await Promise.all([
    supabase
      .from("conhecimento_artigos")
      .select("id, slug, modulo, titulo, resumo, conteudo, publicado, updated_at")
      .eq("slug", slug)
      .maybeSingle(),
    quemVeArtigo(),
    podeEscreverConhecimento(),
  ]);
  // manual de tela que a pessoa não usa não existe para ela
  if (!artigo || !ve(artigo.modulo)) notFound();

  const imagens = await assinarImagens(imagensDoConteudo(artigo.conteudo));
  const secoes = sumario(artigo.conteudo);
  const modulo = artigo.modulo ? MODULE_BY_KEY[artigo.modulo as ModuleKey] : null;

  return (
    <div>
      <Link href="/conhecimento" className="muted" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.84rem", marginBottom: "0.9rem" }}>
        <ArrowLeft size={15} /> Banco de conhecimento
      </Link>
      <PageHeader
        title={artigo.titulo}
        subtitle={artigo.resumo ?? undefined}
        action={
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {modulo && (
              <Link href={modulo.href} className="btn btn-ghost btn-sm">
                <ExternalLink size={15} /> Abrir {modulo.label}
              </Link>
            )}
            {escreve && (
              <Link href={`/conhecimento/${artigo.slug}/editar`} className="btn btn-primary btn-sm">
                <Pencil size={15} /> Editar
              </Link>
            )}
          </div>
        }
      />
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", margin: "-1rem 0 1.5rem" }}>
        {!artigo.publicado && <Badge tone="amber">Rascunho, só você vê</Badge>}
        {modulo && <Badge variant="quiet" tone="blue">{modulo.label}</Badge>}
        <span className="soft" style={{ fontSize: "0.8rem" }}>Atualizado em {formatDate(artigo.updated_at)}</span>
      </div>

      <div className="mh-artigo-layout">
        <article className="card" style={{ padding: "1.5rem 1.75rem", minWidth: 0 }}>
          <Markdown conteudo={artigo.conteudo} imagens={imagens} />
        </article>
        {secoes.length > 1 && (
          <nav className="mh-artigo-indice so-desktop" aria-label="Nesta página">
            <span className="mh-artigo-indice-titulo">Nesta página</span>
            {secoes.map((s) => <a key={s.id} href={`#${s.id}`}>{s.texto}</a>)}
          </nav>
        )}
      </div>
    </div>
  );
}
