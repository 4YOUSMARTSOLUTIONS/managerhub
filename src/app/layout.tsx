import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { getTheme } from "@/lib/theme";
import { Toaster } from "@/components/ui/Toaster";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "MANAGERHUB",
  description: "Portal de gestão — reuniões, salas, ações, chamados e metas.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = await getTheme();
  return (
    <html lang="pt-BR" data-theme={theme} className={`${inter.variable} ${jetbrains.variable}`}>
      <body>
        {children}
        <Toaster theme={theme} />
      </body>
    </html>
  );
}
