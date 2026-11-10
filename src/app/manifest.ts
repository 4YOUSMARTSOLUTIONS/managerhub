import type { MetadataRoute } from "next";

/**
 * Manifesto do aplicativo instalável (PWA), servido em /manifest.webmanifest.
 *
 * As cores são hex de propósito: o manifesto não lê CSS. Espelham `--mh-bg` do
 * tema escuro, o padrão do produto, e o navegador busca este arquivo sem os
 * cookies do usuário, então não dá para seguir o tema escolhido. A barra do
 * aplicativo aberto segue o tema pela `theme-color` do layout raiz.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "MANAGERHUB",
    short_name: "MANAGERHUB",
    description: "Portal de gestão: reuniões, ações, chamados, metas, férias e equipe.",
    lang: "pt-BR",
    dir: "ltr",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#0a0d14",
    theme_color: "#0a0d14",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
