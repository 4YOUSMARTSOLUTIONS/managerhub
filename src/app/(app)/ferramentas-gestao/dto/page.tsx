import { Workflow } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function DtoPage() {
  const gate = await moduleGate("dto");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="DTO" subtitle="Diagnóstico e Tratamento Operacional." />
      <ComingSoon icon={<Workflow size={24} />} />
    </div>
  );
}
