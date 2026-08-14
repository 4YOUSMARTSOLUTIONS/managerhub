import { MessageCircle } from "lucide-react";
import { moduleGate } from "@/lib/module-gate";
import { requireContext } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * Chat interno.
 *
 * Conversas 1 a 1 e grupos entre os usuários da empresa, com tempo real,
 * presença, anexos e busca. Esta é a casca da Leva 1: as conversas chegam na
 * Leva 2 (lista + mensagens) e o tempo real na Leva 3.
 */
export default async function ChatPage() {
  const gate = await moduleGate("chat");
  if (gate) return gate;

  const { tenant } = await requireContext();

  return (
    <div>
      <PageHeader
        title="Chat interno"
        subtitle={tenant.name}
      />
      <EmptyState
        icon={<MessageCircle size={28} />}
        title="As conversas estão chegando"
        description="O chat interno está em construção: conversas 1 a 1, grupos, anexos e busca, tudo dentro do sistema."
      />
    </div>
  );
}
