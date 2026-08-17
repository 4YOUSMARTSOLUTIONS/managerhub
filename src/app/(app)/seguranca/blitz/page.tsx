import { TrafficCone } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function SegurancaBlitzPage() {
  const gate = await moduleGate("seg_blitz");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader
        title="Blitz de trajeto"
        subtitle="Abordagem na rota: o que foi conferido no veículo, no motorista e na carga."
      />
      <ComingSoon
        icon={<TrafficCone size={24} />}
        description="Abordagem na rota: o que foi conferido no veículo, no motorista e na carga."
      />
    </div>
  );
}
