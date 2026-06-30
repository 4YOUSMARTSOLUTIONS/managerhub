import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function FormulariosPage() {
  await requireContext();
  return (
    <div>
      <PageHeader title="Formulários" />
      <EmptyState title="Em construção" description="Esta área será desenvolvida em breve." />
    </div>
  );
}
