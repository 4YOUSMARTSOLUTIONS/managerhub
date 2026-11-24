import { notFound } from "next/navigation";
import { moduleGate } from "@/lib/module-gate";
import { requireContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  BUCKET_FORMULARIOS, COLUNAS_FORMULARIO, formularioDaLinha, situacaoDe,
  type OpcoesPublico, type Respostas,
} from "@/lib/formularios";
import { FormularioTela } from "@/components/formularios/FormularioResponder";

/**
 * Responder um formulário (ou pré-visualizar, para quem o gere). A RLS só
 * entrega o formulário a quem gere ou está no público, então o resto é escolher
 * o que mostrar: o formulário, "você já respondeu" ou "encerrado".
 */
export default async function ResponderFormularioPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ previa?: string }>;
}) {
  const gate = await moduleGate("formularios");
  if (gate) return gate;
  const { user } = await requireContext();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const [{ data: linha }, { data: gere }, { data: souPublico }, { data: minhas }, { data: respondi }] = await Promise.all([
    supabase.from("formularios").select(COLUNAS_FORMULARIO).eq("id", id).maybeSingle(),
    supabase.rpc("formulario_gere", { p_form: id }),
    supabase.rpc("formulario_sou_publico", { p_form: id }),
    supabase.from("formulario_respostas").select("id, respostas, arquivos, enviada_em, editada_em, tenant_id")
      .eq("formulario_id", id).eq("respondente_id", user.id).order("enviada_em", { ascending: false }).limit(1),
    supabase.from("formulario_respondentes").select("respostas").eq("formulario_id", id).eq("user_id", user.id).maybeSingle(),
  ]);
  if (!linha) notFound();
  const f = formularioDaLinha(linha as unknown as Parameters<typeof formularioDaLinha>[0]);

  const { data: autor } = f.criadoPor
    ? await supabase.from("profiles").select("full_name").eq("id", f.criadoPor).maybeSingle()
    : { data: null };

  // a pergunta "Colaborador" precisa da lista de pessoas da empresa
  let pessoas: { id: string; nome: string }[] = [];
  if (f.campos.some((c) => c.tipo === "colaborador" && !c.removido)) {
    const { data: op } = await supabase.rpc("formulario_opcoes_publico");
    pessoas = ((op as unknown as OpcoesPublico | null)?.pessoas ?? []).map((p) => ({ id: p.id, nome: p.nome }));
  }

  const ultima = minhas?.[0] ?? null;
  // links das fotos da própria resposta (a RLS acabou de confirmar que ela é da pessoa)
  const urlsMinha: Record<string, string> = {};
  if (ultima?.arquivos?.length) {
    const prefixo = `${ultima.tenant_id}/${id}/`;
    const paths = ultima.arquivos.filter((p: string) => p.startsWith(prefixo));
    if (paths.length) {
      const { data } = await createServiceClient().storage.from(BUCKET_FORMULARIOS).createSignedUrls(paths, 3600);
      for (const d of data ?? []) if (d.path && d.signedUrl) urlsMinha[d.path] = d.signedUrl;
    }
  }

  const situacao = situacaoDe(f);
  return (
    <FormularioTela
      key={`${f.id}-${f.updatedAt}`}
      form={f}
      criadoPorNome={autor?.full_name ?? "—"}
      previa={sp.previa === "1" && !!gere}
      foraDoPublico={!souPublico || situacao === "rascunho"}
      situacao={situacao}
      minhasRespostas={respondi?.respostas ?? 0}
      minhaResposta={ultima ? {
        id: ultima.id, respostas: (ultima.respostas ?? {}) as Respostas,
        enviadaEm: ultima.enviada_em, editadaEm: ultima.editada_em,
      } : null}
      urlsMinha={urlsMinha}
      pessoas={pessoas}
      gere={!!gere}
      verHistorico={situacao !== "rascunho" && (!!gere || (!f.privado && !!souPublico))}
    />
  );
}
