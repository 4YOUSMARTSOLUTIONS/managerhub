import { Siren } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function SegurancaAcidentesPage() {
  const gate = await moduleGate("seg_acidentes");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="Acidentes" subtitle="Registro, investigação e tratativa de acidentes de trabalho." />
      <ComingSoon icon={<Siren size={24} />} />
    </div>
  );
}
