import { GraduationCap } from "lucide-react";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { moduleGate } from "@/lib/module-gate";

export default async function TreinamentosPage() {
  const gate = await moduleGate("treinamentos");
  if (gate) return gate;

  await requireContext();
  return (
    <div>
      <PageHeader title="Treinamentos" subtitle="Trilhas, turmas e controle de presença dos treinamentos." />
      <ComingSoon icon={<GraduationCap size={24} />} />
    </div>
  );
}
