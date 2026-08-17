import { ClipboardCheck } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function SegurancaGabaritosPage() {
  const gate = await moduleGate("seg_gabaritos");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader
        title="Gabaritos de segurança"
        subtitle="Os padrões que a inspeção usa para dizer se está conforme ou não."
      />
      <ComingSoon
        icon={<ClipboardCheck size={24} />}
        description="Os padrões que a inspeção usa para dizer se está conforme ou não."
      />
    </div>
  );
}
