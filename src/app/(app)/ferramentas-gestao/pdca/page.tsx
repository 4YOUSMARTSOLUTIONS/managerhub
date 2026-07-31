import { RefreshCw } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function PdcaPage() {
  const gate = await moduleGate("pdca");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="PDCA" subtitle="Planejar, executar, verificar e agir." />
      <ComingSoon icon={<RefreshCw size={24} />} />
    </div>
  );
}
