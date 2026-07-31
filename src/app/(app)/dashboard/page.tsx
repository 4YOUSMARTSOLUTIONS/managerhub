import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function DashboardPage() {
  const { tenant } = await requireContext();

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`Visão geral de ${tenant.name}`} />

      <div className="card">
        <EmptyState
          badge="Em breve"
          title="Painel em construção"
          description="Os indicadores e visuais do dashboard serão adicionados aqui."
        />
      </div>
    </div>
  );
}
