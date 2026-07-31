import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { moduleGate } from "@/lib/module-gate";

export default async function CentralSdpoPage() {
  const gate = await moduleGate("central_sdpo");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="Central SDPO" subtitle="Programa de Excelência (SDPO)." />
      <EmptyState title="Em construção" description="Esta área será desenvolvida em breve." />
    </div>
  );
}
