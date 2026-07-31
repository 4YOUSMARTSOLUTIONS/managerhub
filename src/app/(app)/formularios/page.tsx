import { FileText } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function FormulariosPage() {
  const gate = await moduleGate("formularios");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="Formulários" subtitle="Construtor de formulários personalizados para a operação." />
      <ComingSoon icon={<FileText size={24} />} />
    </div>
  );
}
