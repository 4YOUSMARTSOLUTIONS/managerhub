import { Cloud } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function SonhoPage() {
  const gate = await moduleGate("sonho");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="Sonho" />
      <ComingSoon icon={<Cloud size={24} />} />
    </div>
  );
}
