import { requireContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { moduleGate } from "@/lib/module-gate";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegPiramideDashboard, type PainelSeguranca } from "@/components/SegPiramideDashboard";

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
  searchParams: Promise<{ ano?: string; unidade?: string }>;
}) {
  const gate = await moduleGate("seg_piramide");
  if (gate) return gate;

  const { tenant } = await requireContext();
  const supabase = await createClient();
  const sp = await searchParams;

  const agora = new Date();
  const ano = Number(sp.ano) || agora.getFullYear();
  const unidade = sp.unidade || "";

  const [{ data: painel }, { data: units }] = await Promise.all([
    supabase.rpc("seg_dashboard", { p_ano: ano, p_unit_id: unidade || null }),
    supabase.from("units").select("id, name").eq("tenant_id", tenant.id).order("name"),
  ]);

  return (
    <div>
      <PageHeader
        title="Pirâmide de segurança"
        subtitle="Quanto mais a base é relatada e tratada, menos o topo acontece."
      />
      <SegPiramideDashboard
        painel={(painel ?? null) as PainelSeguranca | null}
        ano={ano}
        unidade={unidade}
        unidades={(units ?? []).map((u) => ({ id: u.id, name: u.name }))}
      />
    </div>
  );
}
