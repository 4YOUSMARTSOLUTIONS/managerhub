import { Grid3x3 } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function SwotPage() {
  const gate = await moduleGate("swot");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="SWOT" subtitle="Forças, fraquezas, oportunidades e ameaças." />
      <ComingSoon icon={<Grid3x3 size={24} />} />
    </div>
  );
}
