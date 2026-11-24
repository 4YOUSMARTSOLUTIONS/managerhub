import { notFound } from "next/navigation";
import { moduleGate } from "@/lib/module-gate";
import { requireContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { fetchAll, emLotes } from "@/lib/supabase/fetch-all";
import { COLUNAS_FORMULARIO, formularioDaLinha, type Respostas } from "@/lib/formularios";
import { FormularioRespostas, type LinhaResposta } from "@/components/formularios/FormularioRespostas";

/** Respostas de um formulário: só quem o gere (autor, Proprietário, Administrador). */
export default async function RespostasFormularioPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await moduleGate("formularios");
  if (gate) return gate;
  const { tenant } = await requireContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const [{ data: linha }, { data: gere }, { data: resp }, { data: resumo }, { data: unidades }] = await Promise.all([
    supabase.from("formularios").select(COLUNAS_FORMULARIO).eq("id", id).maybeSingle(),
    supabase.rpc("formulario_gere", { p_form: id }),
    fetchAll(() => supabase.from("formulario_respostas")
      .select("id, respondente_id, respondente_nome, unidade_id, respostas, arquivos, enviada_em, editada_em")
      .eq("formulario_id", id).order("enviada_em", { ascending: false }).order("id")),
    supabase.rpc("formulario_resumo", { p_form: id }),
    supabase.from("units").select("id, name").eq("tenant_id", tenant.id),
  ]);
  if (!linha || !gere) notFound();
  const f = formularioDaLinha(linha as unknown as Parameters<typeof formularioDaLinha>[0]);

  const nomeUnidade = new Map((unidades ?? []).map((u) => [u.id, u.name]));
  const pessoas = [...new Set((resp ?? []).map((r) => r.respondente_id).filter((x): x is string => !!x))];
  const matriculas = new Map<string, string>();
  if (pessoas.length) {
    const { data: ms } = await emLotes(pessoas, (lote) =>
      supabase.from("memberships").select("user_id, employee_code").eq("tenant_id", tenant.id).in("user_id", lote));
    for (const m of ms ?? []) if (m.employee_code) matriculas.set(m.user_id, m.employee_code);
  }

  const total = resp?.length ?? 0;
  const linhas: LinhaResposta[] = (resp ?? []).map((r, i) => ({
    id: r.id,
    numero: total - i,
    respondenteId: r.respondente_id,
    respondenteNome: r.respondente_nome,
    matricula: r.respondente_id ? matriculas.get(r.respondente_id) ?? null : null,
    unidade: r.unidade_id ? nomeUnidade.get(r.unidade_id) ?? null : null,
    respostas: (r.respostas ?? {}) as Respostas,
    temArquivos: (r.arquivos ?? []).length > 0,
    enviadaEm: r.enviada_em,
    editadaEm: r.editada_em,
  }));

  const rs = (resumo ?? {}) as { publico?: number; responderam?: number; respostas?: number };
  return (
    <FormularioRespostas
      key={`${f.id}-${f.updatedAt}-${total}`}
      form={f}
      linhas={linhas}
      resumo={{ publico: rs.publico ?? 0, responderam: rs.responderam ?? 0, respostas: rs.respostas ?? total }}
    />
  );
}
