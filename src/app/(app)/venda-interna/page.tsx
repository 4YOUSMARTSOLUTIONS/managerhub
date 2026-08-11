import { Store } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function VendaInternaPage() {
  const gate = await moduleGate("venda_interna");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="Venda Interna" subtitle="Gestão da venda interna: pedidos, campanhas e acompanhamento." />
      <ComingSoon icon={<Store size={24} />} />
    </div>
  );
}
