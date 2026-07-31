import { Triangle } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function SegurancaPiramidePage() {
  const gate = await moduleGate("seg_piramide");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="Pirâmide" subtitle="Pirâmide de segurança: da ocorrência sem lesão ao acidente grave." />
      <ComingSoon icon={<Triangle size={24} />} />
    </div>
  );
}
