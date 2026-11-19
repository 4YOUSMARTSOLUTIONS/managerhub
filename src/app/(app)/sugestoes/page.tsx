import { requireContext } from "@/lib/tenant";
import { exigirTelaBase } from "@/lib/module-gate";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { PageHeader } from "@/components/ui/PageHeader";
import { SugestoesManager } from "@/components/sugestoes/SugestoesManager";
import type { Sugestao } from "@/lib/sugestoes";

/** início da janela do "em alta": curtidas dos últimos 30 dias */
function trintaDiasAtras(): string {
  return new Date(Date.now() - 30 * 86400000).toISOString();
}

/**
 * Sugestões (LUIZ, 18/11/2026): todos sugerem melhorias para o portal, curtem
 * e comentam; o Proprietário faz a triagem. Comunidade única entre empresas:
 * a lista é a mesma para todas, com o nome e a empresa de quem escreveu.
 */
export default async function SugestoesPage() {
  await exigirTelaBase("sugestoes");
  const { user, role, isSuperAdmin } = await requireContext();
  const supabase = await createClient();
  const desde = trintaDiasAtras();

  const [{ data: linhas }, { data: recentes }, { data: minhas }, { data: sigo }, { data: artigos }] = await Promise.all([
    fetchAll(() => supabase
      .from("sugestoes")
      .select("id, titulo, descricao, modulo, imagens, status, status_em, resposta, resposta_em, resposta_por_nome, duplicada_de, artigo_slug, oculta, oculta_motivo, curtidas, comentarios, autor_id, autor_nome, empresa_nome, created_at")
      .order("created_at", { ascending: false })
      .order("id")),
    // "em alta": curtidas dos últimos 30 dias
    fetchAll(() => supabase.from("sugestao_curtidas").select("sugestao_id").gte("created_at", desde)
      .order("sugestao_id").order("user_id")),
    fetchAll(() => supabase.from("sugestao_curtidas").select("sugestao_id").eq("user_id", user.id)
      .order("sugestao_id")),
    // a RLS só devolve as linhas da própria pessoa
    fetchAll(() => supabase.from("sugestao_seguidores").select("sugestao_id, segue").order("sugestao_id")),
    // para a triagem ligar a entregue ao manual
    supabase.from("conhecimento_artigos").select("slug, titulo").eq("publicado", true).order("titulo"),
  ]);

  const recentesPor = new Map<string, number>();
  for (const r of recentes ?? []) recentesPor.set(r.sugestao_id, (recentesPor.get(r.sugestao_id) ?? 0) + 1);
  const curti = new Set((minhas ?? []).map((m) => m.sugestao_id));
  const segue = new Map((sigo ?? []).map((s) => [s.sugestao_id, s.segue]));

  const sugestoes: Sugestao[] = (linhas ?? []).map((s) => ({
    id: s.id,
    titulo: s.titulo,
    descricao: s.descricao,
    modulo: s.modulo,
    imagens: s.imagens ?? [],
    status: s.status,
    statusEm: s.status_em,
    resposta: s.resposta,
    respostaEm: s.resposta_em,
    respostaPorNome: s.resposta_por_nome,
    duplicadaDe: s.duplicada_de,
    artigoSlug: s.artigo_slug,
    oculta: s.oculta,
    ocultaMotivo: s.oculta_motivo,
    curtidas: s.curtidas,
    comentarios: s.comentarios,
    autorId: s.autor_id,
    autorNome: s.autor_nome,
    empresaNome: s.empresa_nome,
    createdAt: s.created_at,
    curtidas30d: recentesPor.get(s.id) ?? 0,
    curti: curti.has(s.id),
    sigo: segue.get(s.id) ?? false,
  }));

  return (
    <div>
      <PageHeader
        title="Sugestões"
        subtitle="Ideias para melhorar o portal: sugira, curta as que você apoia e comente"
      />
      <SugestoesManager
        sugestoes={sugestoes}
        meuId={user.id}
        podeTriar={isSuperAdmin || role === "owner"}
        artigos={(artigos ?? []).map((a) => ({ slug: a.slug, titulo: a.titulo }))}
      />
    </div>
  );
}
