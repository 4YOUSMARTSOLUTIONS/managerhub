import { Boxes } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function CincoSPage() {
  const gate = await moduleGate("cinco_s");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="5S" subtitle="Programa de organização e qualidade do ambiente." />
      <ComingSoon icon={<Boxes size={24} />} />
    </div>
  );
}
