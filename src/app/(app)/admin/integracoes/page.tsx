import { requireSuperAdmin } from "@/lib/platform";
import { getPlatformIntegrationFlags } from "@/lib/platform-integrations";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { OpenAISettingsForm } from "@/components/OpenAISettingsForm";
import { ResendSettingsForm } from "@/components/ResendSettingsForm";

export default async function AdminIntegracoesPage() {
  await requireSuperAdmin();
  const flags = await getPlatformIntegrationFlags();

  return (
    <div>
      <PageHeader
        title="Integrações"
        subtitle="Chaves e serviços externos da plataforma, nas contas do proprietário do sistema. Valem para todas as empresas; nenhum usuário de empresa vê estes valores."
      />
      <AdminTabs />
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 760 }}>
        <Section title="Integração com IA (OpenAI)">
          <OpenAISettingsForm
            hasKey={flags.hasOpenAI}
            model={flags.openaiModel}
            transcribeModel={flags.openaiTranscribeModel}
            canEdit
          />
        </Section>
        <Section title="Envio de e-mail / Convites (Resend)">
          <ResendSettingsForm hasKey={flags.hasResend} canEdit />
        </Section>
      </div>
    </div>
  );
}
