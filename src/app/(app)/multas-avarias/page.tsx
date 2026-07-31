import { TriangleAlert } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function MultasAvariasPage() {
  const gate = await moduleGate("multas_avarias");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="Multas e Avarias" subtitle="Registro e tratativa de multas de trânsito e avarias de frota." />
      <ComingSoon icon={<TriangleAlert size={24} />} />
    </div>
  );
}
