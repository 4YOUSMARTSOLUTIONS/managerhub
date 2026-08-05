"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Botão que abre um painel: serve tanto para os filtros quanto para o menu de
 * ações secundárias.
 *
 * O comportamento (fechar no Escape, fechar ao clicar fora, `aria-expanded`) é o
 * mesmo que o UserMenu já usava. Foi extraído para cá em vez de copiado: um
 * terceiro menu com regras ligeiramente diferentes é como a interface começa a
 * parecer feita por gente diferente.
 *
 * `children` aceita uma função para o conteúdo poder se fechar sozinho. Sem
 * isso, clicar num item de ação deixaria o menu aberto por cima do diálogo que
 * ele acabou de abrir.
 */
export function Dropdown({
  rotulo,
  icone,
  contador,
  largura = 260,
  alinharDireita = false,
  variante = "ghost",
  titulo,
  children,
}: {
  rotulo: string;
  icone?: React.ReactNode;
  /** selo numérico: quantos filtros estão ativos. Zero não aparece. */
  contador?: number;
  largura?: number;
  alinharDireita?: boolean;
  variante?: "ghost" | "primary";
  titulo?: string;
  children: React.ReactNode | ((fechar: () => void) => React.ReactNode);
}) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [aberto]);

  const fechar = () => setAberto(false);
  const temContador = (contador ?? 0) > 0;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className={`btn btn-${variante}`}
        aria-expanded={aberto}
        aria-haspopup="true"
        title={titulo}
        onClick={() => setAberto((v) => !v)}
        style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}
      >
        {icone}
        {rotulo}
        {temContador && (
          <span
            aria-label={`${contador} filtro(s) ativo(s)`}
            style={{
              minWidth: 18, height: 18, padding: "0 5px",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              borderRadius: 999, fontSize: "0.7rem", fontWeight: 700, lineHeight: 1,
              background: "var(--mh-primary-500)", color: "#fff",
            }}
          >
            {contador}
          </span>
        )}
        <ChevronDown size={14} style={{ transform: aberto ? "rotate(180deg)" : "none", transition: "transform var(--mh-dur-fast) var(--mh-ease)" }} />
      </button>

      {aberto && (
        <div
          className="card"
          style={{
            position: "absolute",
            top: "calc(100% + 0.4rem)",
            [alinharDireita ? "right" : "left"]: 0,
            width: largura,
            zIndex: 40,
            padding: "0.75rem",
            boxShadow: "var(--mh-shadow-e3)",
            display: "flex",
            flexDirection: "column",
            gap: "0.7rem",
          }}
        >
          {typeof children === "function" ? children(fechar) : children}
        </div>
      )}
    </div>
  );
}

/** Item clicável do menu de ações. Fecha o menu ao ser acionado. */
export function ItemDeMenu({
  children, onClick, disabled, titulo,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  titulo?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={titulo}
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", width: "100%",
        padding: "0.5rem 0.6rem", borderRadius: "var(--mh-radius-sm)",
        background: "none", border: "none", font: "inherit",
        fontSize: "0.86rem", textAlign: "left",
        color: disabled ? "var(--mh-text-3)" : "var(--mh-text-1)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "var(--mh-surface-2)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
    >
      {children}
    </button>
  );
}
