import { requireContext, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { moduleGate } from "@/lib/module-gate";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegPiramideDashboard, type PainelSeguranca } from "@/components/SegPiramideDashboard";
import { SegFocosPanel } from "@/components/SegFocosPanel";
import { getAlertasResumo, getFocosStatus } from "@/lib/actions/seguranca";

/**
 * Pirâmide de Heinrich e painel de segurança.
 *
 * A leitura que o módulo inteiro existe para permitir: quanto mais a base
 * cresce (desvio relatado e tratado), menos o topo acontece. Por isso a mesma
 * tela mostra a pirâmide e o quanto se está tratando, e não só a contagem.
 *
 * Tudo vem de uma RPC só. Eram dez recortes do mesmo período, e cada um viraria
 * uma ida e volta até o banco se fosse feito aqui. A RPC também é quem decide
 * se o bloco por setor e por gestor acompanha: para quem não trata segurança,
 * o painel mostra o todo sem apontar dedo.
 */
export default async function SegurancaPiramidePage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string; tipo?: string }>;
}) {
  const gate = await moduleGate("seg_piramide");
  if (gate) return gate;

  // A unidade vem do seletor DO TOPO, e de lugar nenhum mais: o recorte é um
  // só na aplicação inteira, e um segundo filtro dentro da tela criaria duas
  // respostas para a mesma pergunta.
  const { unitScope } = await requireContext();
  const supabase = await createClient();
  const sp = await searchParams;

  const agora = new Date();
  const ano = Number(sp.ano) || agora.getFullYear();
  // típico e trajeto contam juntos por padrão; o filtro é uma escolha de quem
  // olha, e valor estranho na URL vira "sem filtro" em vez de erro
  const tipo = sp.tipo === "tipico" || sp.tipo === "trajeto" ? sp.tipo : null;
  const unidades = effectiveUnitFilter(unitScope);

  // O foco não segue o ano do filtro: ele é o que está valendo HOJE. Vem
  // junto porque é aqui que a causa dominante é lida e a decisão é tomada.
  const [{ data: painel }, focos, alertas, { data: areas }, { data: causas }] = await Promise.all([
    supabase.rpc("seg_dashboard", { p_ano: ano, p_unit_ids: unidades, p_tipo: tipo }),
    getFocosStatus(),
    getAlertasResumo(ano),
    supabase.from("seg_areas").select("id, name").eq("active", true).order("name"),
    supabase.from("seg_causas").select("id, name").eq("active", true).order("sort").order("name"),
  ]);

  return (
    <div>
      <PageHeader
        title="Pirâmide de segurança"
        subtitle="Quanto mais a base é relatada e tratada, menos o topo acontece."
      />
      <SegFocosPanel status={focos} areas={areas ?? []} causas={causas ?? []} />
      <SegPiramideDashboard
        painel={(painel ?? null) as PainelSeguranca | null}
        ano={ano}
        tipo={tipo}
        alertas={alertas}
      />
    </div>
  );
}
