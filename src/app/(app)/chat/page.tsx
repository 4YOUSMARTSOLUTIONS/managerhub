import { moduleGate } from "@/lib/module-gate";
import { requireContext, getMembers } from "@/lib/tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { getConversas, getPreferencias } from "@/lib/actions/chat";
import { ChatManager } from "@/components/chat/ChatManager";

/**
 * Chat interno.
 *
 * Conversas 1 a 1 e grupos entre os usuários da empresa. A lista e o histórico
 * chegam por server action (RLS decide o alcance; owner/admin/hr enxergam tudo
 * pela política de auditoria); mensagens novas, presença e toasts chegam por
 * Supabase Realtime dentro do ChatManager.
 */
export default async function ChatPage() {
  const gate = await moduleGate("chat");
  if (gate) return gate;

  const { tenant, user, role } = await requireContext();
  // mesma régua de is_chat_admin no banco: owner/admin/hr administram o chat
  const souAdminChat = role === "owner" || role === "admin" || role === "hr";

  const [membros, conversas, prefs] = await Promise.all([
    getMembers(tenant.id),
    getConversas(),
    getPreferencias(),
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
      <ChatManager
        conversas={conversas}
        pessoas={pessoas}
        meuId={user.id}
        tenantId={tenant.id}
        prefs={prefs}
        souAdminChat={souAdminChat}
      />
    </div>
  );
}
