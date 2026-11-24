"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";

export type ItemDaLinha = {
  rotulo: string;
  icone: React.ReactNode;
  onClick: () => void;
  perigo?: boolean;
};

const ALTURA_ITEM = 32;
const FOLGA = 4;

/**
 * Botão ⋮ com as ações de uma linha de tabela.
 *
 * O painel vai para o `body` com posição fixa porque a tabela fica numa caixa
 * com rolagem lateral, e um menu comum seria cortado por ela. Pelo mesmo motivo
 * ele fecha ao rolar: não há como acompanhar a linha sem ficar flutuando.
 */
export function MenuDeLinha({ rotulo, itens }: { rotulo: string; itens: ItemDaLinha[] }) {
  const [pos, setPos] = useState<{ right: number; top?: number; bottom?: number } | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);
  const aberto = pos !== null;

  useEffect(() => {
    if (!aberto) return;
    const fechar = () => setPos(null);
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (!painel.current?.contains(alvo) && !botao.current?.contains(alvo)) fechar();
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") { fechar(); botao.current?.focus(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const lista = [...(painel.current?.querySelectorAll("button") ?? [])];
      const atual = lista.indexOf(document.activeElement as HTMLButtonElement);
      const passo = e.key === "ArrowDown" ? 1 : -1;
      lista[(atual + passo + lista.length) % lista.length]?.focus({ preventScroll: true });
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    window.addEventListener("scroll", fechar, true);
    window.addEventListener("resize", fechar);
    // o painel mora no fim do body: sem isto o Tab nunca chegaria nele
    painel.current?.querySelector("button")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("scroll", fechar, true);
      window.removeEventListener("resize", fechar);
    };
  }, [aberto]);

  const alternar = () => {
    if (aberto || !botao.current) { setPos(null); return; }
    const r = botao.current.getBoundingClientRect();
    const tela = document.documentElement;
    const altura = itens.length * ALTURA_ITEM + 10;
    const right = tela.clientWidth - r.right;
    // perto do fim da tela abre para cima, senão os últimos itens ficariam de fora
    setPos(r.bottom + altura + FOLGA > tela.clientHeight
      ? { right, bottom: tela.clientHeight - r.top + FOLGA }
      : { right, top: r.bottom + FOLGA });
  };

  return (
    <>
      <button
        ref={botao}
        type="button"
        className="icon-btn"
        title="Opções"
        aria-label={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={alternar}
      >
        <MoreVertical size={15} />
      </button>
      {pos && createPortal(
        <div
          ref={painel}
          role="menu"
          aria-label={rotulo}
          className="card"
          style={{ position: "fixed", ...pos, zIndex: 70, minWidth: 136, padding: "0.25rem", boxShadow: "var(--mh-shadow-e3)", display: "flex", flexDirection: "column", gap: 1 }}
        >
          {itens.map((item) => (
            <button
              key={item.rotulo}
              type="button"
              role="menuitem"
              className="data-menu-item"
              onClick={() => { setPos(null); item.onClick(); }}
              style={{
                display: "flex", alignItems: "center", gap: "0.5rem", width: "100%",
                minHeight: ALTURA_ITEM - 1, padding: "0.3rem 0.55rem", border: "none",
                borderRadius: "var(--mh-radius-sm)", background: "none", font: "inherit",
                fontSize: "0.8rem", textAlign: "left", whiteSpace: "nowrap",
                color: item.perigo ? "var(--mh-danger)" : "var(--mh-text-1)",
              }}
            >
              {item.icone}
              {item.rotulo}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
