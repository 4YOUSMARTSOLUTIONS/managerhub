import type { NextConfig } from "next";

/** Origem do Supabase, para liberar no CSP o que o app realmente chama. */
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseWs = supabase.replace(/^https:/, "wss:");

/**
 * Política de conteúdo em modo RELATÓRIO.
 *
 * Report-Only não bloqueia nada: o navegador só avisa no console o que ELE
 * bloquearia se a política estivesse valendo. É o jeito de descobrir o que quebra
 * antes de quebrar. O Next injeta script inline no bootstrap, então ligar de
 * verdade exige antes uma rodada de observação com o app em uso.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabase}`,
  "font-src 'self' data:",
  `connect-src 'self' ${supabase} ${supabaseWs}`,
  `media-src 'self' blob: ${supabase}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  devIndicators: {
    position: "bottom-right",
  },
  serverExternalPackages: ["pdfjs-dist"],

  experimental: {
    serverActions: {
      /**
       * O padrão do Next é 1 MB, e a gravação de reunião sobe o áudio por Server
       * Action. A 48 kbps isso dá menos de 3 minutos: qualquer reunião de verdade
       * falhava no envio. 25 MB cobrem cerca de 70 minutos de áudio e continuam
       * sendo um teto. O bucket meeting-audio usa o mesmo número.
       */
      bodySizeLimit: "25mb",
    },
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // clickjacking: o portal nunca deve ser embutido em iframe de terceiro
          { key: "X-Frame-Options", value: "DENY" },
          // impede o navegador de "adivinhar" o tipo de um arquivo servido
          { key: "X-Content-Type-Options", value: "nosniff" },
          // não vaza a URL interna (que carrega ids) para sites externos
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // microfone liberado só para a própria origem: a gravação de reunião usa
          {
            key: "Permissions-Policy",
            value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()",
          },
          { key: "Content-Security-Policy-Report-Only", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
