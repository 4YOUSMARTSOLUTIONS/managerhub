import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { getTheme } from "@/lib/theme";
import { CAPTURA_INSTALACAO } from "@/lib/pwa";
import { Toaster } from "@/components/ui/Toaster";
import { PwaRegistro } from "@/components/pwa/PwaRegistro";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "MANAGERHUB",
  description: "Portal de gestão: reuniões, salas, ações, chamados e metas.",
  // nome do aplicativo instalado (o mesmo do manifesto)
  applicationName: "Manager HUB",
  // iPhone: abre em tela cheia pelo ícone da tela inicial, com o nome certo
  appleWebApp: { capable: true, title: "Manager HUB", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

/**
 * A cor da barra do aplicativo instalado (e da barra do navegador no celular)
 * segue o tema escolhido. Hex porque é meta tag, não CSS: espelha `--mh-bg`.
 */
export async function generateViewport(): Promise<Viewport> {
  const theme = await getTheme();
  return { themeColor: theme === "dark" ? "#0a0d14" : "#f7f8fb" };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = await getTheme();
  return (
    <html lang="pt-BR" data-theme={theme} className={`${inter.variable} ${jetbrains.variable}`}>
      <body>
        {/* antes do React: guarda o aviso de instalação do navegador (ver lib/pwa) */}
        <script dangerouslySetInnerHTML={{ __html: CAPTURA_INSTALACAO }} suppressHydrationWarning />
        {children}
        <Toaster theme={theme} />
        <PwaRegistro />
      </body>
    </html>
  );
}
