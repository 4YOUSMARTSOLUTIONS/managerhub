import { ClipboardList } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function GapaPage() {
  const gate = await moduleGate("gapa");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="GAPA" subtitle="Guia de Análise e Plano de Ação." />
      <ComingSoon icon={<ClipboardList size={24} />} />
    </div>
  );
}
