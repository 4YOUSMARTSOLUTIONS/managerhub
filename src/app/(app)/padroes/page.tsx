import { BookMarked } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function PadroesPage() {
  const gate = await moduleGate("padroes");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="Padrões" subtitle="Padrões operacionais e documentação de processos." />
      <ComingSoon icon={<BookMarked size={24} />} />
    </div>
  );
}
