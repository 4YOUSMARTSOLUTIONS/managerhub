import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { InstalarApp } from "@/components/pwa/InstalarApp";
import { appUrl } from "@/lib/app-url";

export const metadata: Metadata = {
  title: "Instalar o aplicativo · Manager HUB",
  description: "Instale o Manager HUB no celular ou no computador.",
};

/**
 * O link de instalação que o RH manda para a equipe. Pública (ver
 * PUBLIC_PATHS): a instalação não depende de login, e quem a recebe pelo
 * WhatsApp ainda nem entrou no sistema.
 *
 * O link exibido vem da origem fixa do app, não do cabeçalho da requisição.
 */
export default function InstalarPage() {
  return (
    <AuthShell
      title="Instalar o aplicativo"
      subtitle="Use o Manager HUB como um aplicativo: ícone na tela inicial e tela cheia, sem baixar nada da loja."
      footer={<Link href="/">Ir para o portal</Link>}
    >
      <InstalarApp link={`${appUrl()}/instalar`} />
    </AuthShell>
  );
}
