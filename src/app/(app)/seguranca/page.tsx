import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tabs, type Tab } from "@/components/ui/Tabs";

export default async function SegurancaPage() {
  await requireContext();
  const tabs: Tab[] = [
    {
      id: "epis",
      label: "Gestão de EPIs",
      content: <EmptyState title="Em construção" description="Gestão de EPIs será desenvolvida em breve." />,
    },
    {
      id: "relatos",
      label: "Relatos",
      content: <EmptyState title="Em construção" description="Relatos será desenvolvido em breve." />,
    },
  ];
  return (
    <div>
      <PageHeader title="Segurança" />
      <Tabs tabs={tabs} />
    </div>
  );
}
