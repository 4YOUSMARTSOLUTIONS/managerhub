import { HardHat } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function SegurancaEpisPage() {
  const gate = await moduleGate("seg_epis");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="Gestão de EPIs" subtitle="Controle de entrega, troca e vencimento de EPIs por colaborador." />
      <ComingSoon icon={<HardHat size={24} />} description="Controle de entrega, troca e vencimento de EPIs por colaborador." />
    </div>
  );
}
