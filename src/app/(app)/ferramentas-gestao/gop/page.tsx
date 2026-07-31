import { Gauge } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function GopPage() {
  const gate = await moduleGate("gop");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="GOP" subtitle="Gestão Operacional de Processos." />
      <ComingSoon icon={<Gauge size={24} />} />
    </div>
  );
}
