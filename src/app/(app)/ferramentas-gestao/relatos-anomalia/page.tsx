import { Siren } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function RelatosAnomaliaPage() {
  const gate = await moduleGate("relatos_anomalia");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="Relatos de anomalia" subtitle="Registro e tratativa de anomalias identificadas na operação." />
      <ComingSoon icon={<Siren size={24} />} />
    </div>
  );
}
