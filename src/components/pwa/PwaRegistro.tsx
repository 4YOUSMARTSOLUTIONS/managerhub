"use client";

import { useEffect } from "react";

/**
 * Registra o service worker (public/sw.js), que só mostra a página "Sem
 * conexão" quando falta internet.
 *
 * Só em produção: no `next dev` o worker ficaria preso ao localhost:3000 e
 * seguiria vivo em outros projetos abertos na mesma porta.
 */
export function PwaRegistro() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // sem worker o portal funciona igual; só perde a página offline
      });
  }, []);
  return null;
}
