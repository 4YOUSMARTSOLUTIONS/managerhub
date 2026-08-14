import { moduleGate } from "@/lib/module-gate";
import { requireContext, getMembers } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { getConversas } from "@/lib/actions/chat";
import { ChatManager } from "@/components/chat/ChatManager";

/**
 * Chat interno.
 *
 * Conversas 1 a 1 e grupos entre os usuários da empresa. A lista e o histórico
 * chegam por server action (RLS decide o alcance; owner/admin/hr enxergam tudo
 * pela política de auditoria); o tempo real entra na leva seguinte.
 */
export default async function ChatPage() {
  const gate = await moduleGate("chat");
  if (gate) return gate;

  const { tenant, user } = await requireContext();

  const [membros, conversas] = await Promise.all([
    getMembers(tenant.id),
    getConversas(),
  ]);

  const pessoas = membros
    .map((m) => ({ id: m.profile?.id ?? "", name: m.profile?.full_name ?? "" }))
    .filter((p) => p.id && p.name)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div>
      <PageHeader
        title="Chat interno"
        subtitle="Conversas entre as pessoas da empresa, com histórico centralizado"
      />
      <ChatManager conversas={conversas} pessoas={pessoas} meuId={user.id} />
    </div>
  );
}
