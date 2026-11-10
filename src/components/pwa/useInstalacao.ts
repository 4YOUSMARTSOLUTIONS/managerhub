"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  EVENTO_INSTALADO, EVENTO_INSTALAVEL, detectarPlataforma, rodandoComoApp, type Plataforma,
} from "@/lib/pwa";

/** O aviso do Chrome/Edge que permite abrir a caixa de instalação. */
interface AvisoDeInstalacao extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __mhInstalar?: AvisoDeInstalacao | null;
    __mhInstalado?: boolean;
  }
}

function assinar(avisar: () => void) {
  window.addEventListener(EVENTO_INSTALAVEL, avisar);
  window.addEventListener(EVENTO_INSTALADO, avisar);
  const modo = window.matchMedia("(display-mode: standalone)");
  modo.addEventListener("change", avisar);
  return () => {
    window.removeEventListener(EVENTO_INSTALAVEL, avisar);
    window.removeEventListener(EVENTO_INSTALADO, avisar);
    modo.removeEventListener("change", avisar);
  };
}
const nada = () => () => {};

export type ResultadoInstalacao = "aceito" | "recusado" | "indisponivel";

/**
 * Estado da instalação nesta aba. No servidor e na hidratação tudo sai falso
 * (`pronto` também), e a leitura real vem logo depois, já no navegador: quem
 * desenha a tela espera o `pronto` para não piscar a instrução errada.
 */
export function useInstalacao() {
  const pronto = useSyncExternalStore(nada, () => true, () => false);
  const instalado = useSyncExternalStore(assinar, rodandoComoApp, () => false);
  const podeInstalar = useSyncExternalStore(assinar, () => Boolean(window.__mhInstalar), () => false);
  const recemInstalado = useSyncExternalStore(assinar, () => window.__mhInstalado === true, () => false);
  const plataforma = useSyncExternalStore<Plataforma>(
    nada,
    () => detectarPlataforma(navigator.userAgent, navigator.maxTouchPoints ?? 0),
    () => "pc",
  );

  /** Abre a caixa do navegador. O aviso só vale uma vez: depois some. */
  const instalar = useCallback(async (): Promise<ResultadoInstalacao> => {
    const aviso = window.__mhInstalar;
    if (!aviso) return "indisponivel";
    window.__mhInstalar = null;
    try {
      await aviso.prompt();
      const { outcome } = await aviso.userChoice;
      return outcome === "accepted" ? "aceito" : "recusado";
    } catch {
      return "indisponivel";
    } finally {
      window.dispatchEvent(new Event(EVENTO_INSTALAVEL));
    }
  }, []);

  return { pronto, instalado, podeInstalar, recemInstalado, plataforma, instalar };
}
