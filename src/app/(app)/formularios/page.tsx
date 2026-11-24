import { requireContext, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { fetchAll, emLotes } from "@/lib/supabase/fetch-all";
import { PageHeader } from "@/components/ui/PageHeader";
import { moduleGate } from "@/lib/module-gate";
import { COLUNAS_FORMULARIO, formularioDaLinha, situacaoDe, type Formulario } from "@/lib/formularios";
import { FormulariosLista, type LinhaLista } from "@/components/formularios/FormulariosLista";
import { NovoFormularioBotao } from "@/components/formularios/NovoFormularioBotao";

/**
 * Formulários (LUIZ, 24/11/2026). Três recortes na mesma tela:
 *   - Para responder: o que foi enviado para a pessoa (público calculado agora);
 *   - Criados por mim: o que ela criou;
 *   - Todos da empresa: só Proprietário e Administrador, que gerem qualquer um.
 * A RLS já entrega só o que a pessoa pode ver; aqui só se separa.
 */
export default async function FormulariosPage() {
  const gate = await moduleGate("formularios");
  if (gate) return gate;

  const { tenant, user, role, unitScope } = await requireContext();
  const supabase = await createClient();
  const ehAdmin = role === "owner" || role === "admin";

  const [{ data: linhas }, { data: eu }, { data: minhasResp }, { data: respondi }] = await Promise.all([
    fetchAll(() => supabase.from("formularios").select(COLUNAS_FORMULARIO)
      .eq("tenant_id", tenant.id).order("updated_at", { ascending: false }).order("id")),
    supabase.from("memberships").select("id, hierarchy_level_id, position_id")
      .eq("tenant_id", tenant.id).eq("user_id", user.id).maybeSingle(),
    fetchAll(() => supabase.from("formulario_respostas").select("id, formulario_id, enviada_em")
      .eq("respondente_id", user.id).order("enviada_em", { ascending: false }).order("id")),
    fetchAll(() => supabase.from("formulario_respondentes").select("formulario_id, respostas")
      .eq("user_id", user.id).order("formulario_id")),
  ]);

  const forms = ((linhas ?? []) as unknown as Parameters<typeof formularioDaLinha>[0][]).map((l) => formularioDaLinha(l));

  const { data: minhasUnidades } = eu
    ? await supabase.from("membership_units").select("unit_id").eq("membership_id", eu.id)
    : { data: [] as { unit_id: string }[] };
  const unidadesMinhas = new Set((minhasUnidades ?? []).map((u) => u.unit_id));

  // a mesma regra de formulario_no_publico_de, para separar a aba "Para responder"
  const noPublico = (f: Formulario) => {
    if (!eu) return false;
    if (f.publicoPessoas.includes(user.id)) return true;
    const pelaRegra = f.publicoTodos
      || (!!eu.hierarchy_level_id && f.publicoNiveis.includes(eu.hierarchy_level_id))
      || (!!eu.position_id && f.publicoCargos.includes(eu.position_id));
    return pelaRegra && (f.unidades.length === 0 || f.unidades.some((u) => unidadesMinhas.has(u)));
  };

  // nomes de quem criou
  const criadores = [...new Set(forms.map((f) => f.criadoPor).filter((x): x is string => !!x))];
  const nomes = new Map<string, string>();
  if (criadores.length) {
    const { data: perfis } = await emLotes(criadores, (lote) =>
      supabase.from("profiles").select("id, full_name").in("id", lote));
    for (const p of perfis ?? []) nomes.set(p.id, p.full_name ?? "—");
  }

  // contagem de respostas dos que a pessoa gere
  const geridos = forms.filter((f) => f.criadoPor === user.id || ehAdmin).map((f) => f.id);
  const contagem = new Map<string, number>();
  if (geridos.length) {
    const { data: resp } = await emLotes(geridos, (lote) =>
      fetchAll(() => supabase.from("formulario_respostas").select("formulario_id").in("formulario_id", lote).order("id")));
    for (const r of resp ?? []) contagem.set(r.formulario_id, (contagem.get(r.formulario_id) ?? 0) + 1);
  }

  const quantasMinhas = new Map((respondi ?? []).map((r) => [r.formulario_id, r.respostas]));
  const ultimaMinha = new Map<string, string>();
  for (const r of minhasResp ?? []) if (!ultimaMinha.has(r.formulario_id)) ultimaMinha.set(r.formulario_id, r.id);

  const unidadesDoTopo = effectiveUnitFilter(unitScope);
  const lista: LinhaLista[] = forms.map((f) => ({
    ...f,
    criadoPorNome: (f.criadoPor && nomes.get(f.criadoPor)) || "—",
    // calculada no servidor: o prazo vencido encerra sem ninguém precisar encerrar
    situacao: situacaoDe(f),
    paraMim: f.status !== "rascunho" && noPublico(f),
    minhasRespostas: quantasMinhas.get(f.id) ?? 0,
    minhaUltimaResposta: ultimaMinha.get(f.id) ?? null,
    respostas: contagem.get(f.id) ?? 0,
    meu: f.criadoPor === user.id,
    // na aba da empresa vale o seletor de unidade do topo
    naUnidadeDoTopo: !unidadesDoTopo || f.unidades.length === 0 || f.unidades.some((u) => unidadesDoTopo.includes(u)),
  }));

  return (
    <div>
      <PageHeader
        title="Formulários"
        subtitle="Crie formulários, envie para quem precisa responder e acompanhe as respostas."
        action={<NovoFormularioBotao />}
      />
      <FormulariosLista formularios={lista} ehAdmin={ehAdmin} />
    </div>
  );
}
