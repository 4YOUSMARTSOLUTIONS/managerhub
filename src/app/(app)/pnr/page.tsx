import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function PnrPage() {
  await requireContext();
  return (
    <div>
      <PageHeader title="PNR" />
      <EmptyState title="Em construção" description="Esta área será desenvolvida em breve." />
    </div>
  );
}
