"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * O print do artigo e a ampliação dele (LUIZ, 18/11/2026): abrir em outra aba
 * mostrava a imagem num zoom enorme. Agora ela abre no meio da tela, inteira,
 * ajustada ao tamanho da janela. Fecha pelo X ou pelo Esc (o EscToClose acha o
 * botão "Fechar"); clique fora não fecha, como toda janela do portal.
 */
export function FiguraDoArtigo({ url, legenda }: { url: string; legenda: string }) {
  const [aberta, setAberta] = useState(false);

  // a página atrás não rola enquanto a imagem está aberta
  useEffect(() => {
    if (!aberta) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = antes; };
  }, [aberta]);

  return (
    <>
      <button type="button" className="mh-artigo-ampliar" onClick={() => setAberta(true)} title="Clique para ampliar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={legenda} loading="lazy" />
      </button>
      {aberta && typeof document !== "undefined" && createPortal(
        <div className="mh-artigo-visor" role="dialog" aria-modal="true" aria-label={legenda || "Imagem do artigo"}>
          <button type="button" className="mh-artigo-visor-fechar" aria-label="Fechar" onClick={() => setAberta(false)}>
            <X size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={legenda} />
          {legenda && <p>{legenda}</p>}
        </div>,
        document.body,
      )}
    </>
  );
}
