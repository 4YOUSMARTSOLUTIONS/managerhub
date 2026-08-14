import { moduleGate } from "@/lib/module-gate";
import { requireContext, getMembers } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { ChatManager } from "@/components/chat/ChatManager";

/**
 * Chat interno.
 *
 * A página só resolve o que é dela: quem são as pessoas da empresa (para
 * iniciar conversa) e se quem entrou administra o chat. A lista de conversas,
 * as mensagens ao vivo, a presença e as preferências vêm dos providers do
 * shell, que valem em todas as telas (e alimentam o balão do canto).
 */
export default async function ChatPage() {
  const gate = await moduleGate("chat");
  if (gate) return gate;

  const { tenant, user, role } = await requireContext();
  // mesma régua de is_chat_admin no banco: owner/admin/hr administram o chat
  const souAdminChat = role === "owner" || role === "admin" || role === "hr";

  const membros = await getMembers(tenant.id);
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
      <ChatManager pessoas={pessoas} meuId={user.id} souAdminChat={souAdminChat} />
    </div>
  );
}
