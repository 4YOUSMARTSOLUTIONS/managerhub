import { MessageSquareWarning } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function SegurancaRelatosPage() {
  const gate = await moduleGate("seg_relatos");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="Relatos" subtitle="Registro e tratativa de relatos de segurança do trabalho." />
      <ComingSoon icon={<MessageSquareWarning size={24} />} description="Registro e tratativa de relatos de segurança do trabalho." />
    </div>
  );
}
