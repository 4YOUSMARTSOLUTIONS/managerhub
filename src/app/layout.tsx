import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MANAGERHUB",
  description: "Portal de gestão — reuniões, salas, ações, chamados e metas.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
