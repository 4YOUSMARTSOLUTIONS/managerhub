import { DoorOpen } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function PortariaPage() {
  const gate = await moduleGate("portaria");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="Portaria" subtitle="Controle de acesso, visitantes e veículos na portaria." />
      <ComingSoon icon={<DoorOpen size={24} />} />
    </div>
  );
}
