"use client";

import { useEffect, useRef, useState } from "react";
import { DetailModal } from "@/components/ui/DetailModal";
import { sairPorInatividade } from "@/lib/actions/auth";
import { avisarUsoDoAparelho } from "@/components/pwa/usePush";
import { COOKIE_LIMITE, COOKIE_USO, rotuloDoTempo } from "@/lib/sessao";

/** O aviso aparece 1 minuto antes de encerrar. */
const AVISO_MS = 60_000;
/** Gravar o uso a cada toque seria desperdício: uma vez a cada 20 segundos basta. */
const GRAVAR_A_CADA_MS = 20_000;
const TRINTA_DIAS_S = 30 * 86_400;

function lerCookie(nome: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${nome}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}
function gravarCookie(nome: string, valor: string, maxAge: number) {
  const seguro = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${nome}=${encodeURIComponent(valor)}; path=/; max-age=${maxAge}; samesite=lax${seguro}`;
}

/**
 * Encerra a sessão depois do tempo sem uso da pessoa (ver src/lib/sessao.ts).
 *
 * Toque, rolagem, digitação e movimento do mouse contam como uso. App em
 * segundo plano ou com a tela apagada não conta: ao voltar, a conta é refeita
 * na hora. O cookie é o mesmo em todas as abas, então usar uma mantém as
 * outras vivas. Um minuto antes, o aviso pergunta se a pessoa continua.
 */
export function SessaoInatividade({ minutos, agoraServidor, entrouEm }: {
  /** null = sem limite */
  minutos: number | null;
  /** Date.now() do servidor ao montar a página: corrige o relógio do aparelho */
  agoraServidor: number;
  /** hora do login (segundos); 0 = desconhecida */
  entrouEm: number;
}) {
  const [restanteMs, setRestanteMs] = useState<number | null>(null);
  const continuarRef = useRef<() => void>(() => {});
  const sairRef = useRef<() => void>(() => {});
  // diferença entre o relógio do servidor e o do aparelho, fixada na montagem
  const [desvio] = useState(() => agoraServidor - Date.now());

  useEffect(() => {
    if (!minutos) {
      gravarCookie(COOKIE_LIMITE, "", 0);
      return;
    }
    const limiteMs = minutos * 60_000;
    const agora = () => Date.now() + desvio;
    let gravadoEm = 0;
    let saindo = false;

    const ultimoUso = () => Math.max((Number(lerCookie(COOKIE_USO)) || 0) * 1000, entrouEm * 1000);
    const registrar = (forcar = false) => {
      const t = agora();
      if (!forcar && t - gravadoEm < GRAVAR_A_CADA_MS) return;
      gravadoEm = t;
      gravarCookie(COOKIE_USO, String(Math.floor(t / 1000)), TRINTA_DIAS_S);
      void avisarUsoDoAparelho();
    };
    const sair = () => {
      if (saindo) return;
      saindo = true;
      void sairPorInatividade(minutos);
    };
    const verificar = () => {
      if (saindo) return;
      const parado = agora() - ultimoUso();
      if (parado >= limiteMs) { sair(); return; }
      setRestanteMs(parado >= limiteMs - AVISO_MS ? limiteMs - parado : null);
    };

    gravarCookie(COOKIE_LIMITE, String(minutos), TRINTA_DIAS_S);
    // A página só chegou até aqui porque o servidor deu a sessão como viva; a
    // conta vem primeiro (o servidor dá uma folga), e só depois a abertura conta como uso.
    const parado = agora() - ultimoUso();
    if (ultimoUso() > 0 && parado >= limiteMs) { sair(); return; }
    registrar(true);

    continuarRef.current = () => { registrar(true); setRestanteMs(null); };
    sairRef.current = sair;

    const aoUsar = () => { if (!saindo) registrar(); };
    const eventos = ["pointerdown", "keydown", "touchstart", "wheel", "mousemove"] as const;
    eventos.forEach((e) => window.addEventListener(e, aoUsar, { passive: true }));
    window.addEventListener("scroll", aoUsar, { passive: true, capture: true });
    const aoVoltar = () => { if (document.visibilityState === "visible") verificar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    const relogio = window.setInterval(verificar, 1000);

    return () => {
      eventos.forEach((e) => window.removeEventListener(e, aoUsar));
      window.removeEventListener("scroll", aoUsar, { capture: true });
      document.removeEventListener("visibilitychange", aoVoltar);
      window.clearInterval(relogio);
    };
  }, [minutos, entrouEm, desvio]);

  if (restanteMs === null || !minutos) return null;
  const segundos = Math.max(0, Math.ceil(restanteMs / 1000));

  return (
    <DetailModal
      open
      onClose={() => continuarRef.current()}
      title="Você ainda está aí?"
      width="sm"
      // acima de qualquer outro modal aberto
      zIndex={88}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => sairRef.current()}>Sair agora</button>
          <button type="button" className="btn btn-primary" onClick={() => continuarRef.current()}>Continuar usando</button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.55 }}>
        Por segurança, a sessão vai encerrar em <strong>{segundos} segundo{segundos === 1 ? "" : "s"}</strong>,
        depois de {rotuloDoTempo(minutos)} sem uso.
      </p>
      <p className="soft" style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>
        Se o celular é usado por outras pessoas, toque em Sair agora.
      </p>
    </DetailModal>
  );
}
