"use client";

import { X } from "lucide-react";

/**
 * O modal de leitura canônico.
 *
 * Antes dele, cada tela copiava o overlay à mão: o repositório chegou a ter
 * dez z-indexes e dezessete larguras de modal. Aqui a escala é fechada:
 * três larguras, z-index 60, mesmo fundo e mesma sombra em todo lugar.
 *
 * O botão fechar mantém `aria-label="Fechar"` de propósito: `EscToClose`
 * varre o overlay de maior z-index na faixa 40-89 e clica exatamente nesse
 * botão quando a pessoa aperta Esc.
 *
 * Só para LEITURA e ações pontuais. Formulário com server action continua no
 * `FormModal`.
 */
const LARGURAS = { sm: 480, md: 620, lg: 760 } as const;

export function DetailModal({
  open, onClose, title, badges, footer, width = "md", children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** pílulas do cabeçalho; a regra é UMA tintada, o resto quiet (DESIGN.md) */
  badges?: React.ReactNode;
  footer?: React.ReactNode;
  width?: keyof typeof LARGURAS;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "5vh 1rem", zIndex: 60, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: LARGURAS[width], boxShadow: "var(--mh-shadow-e3)" }}>
        <div
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "flex-start",
            gap: "0.8rem", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>{title}</h2>
            {badges && (
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                {badges}
              </div>
            )}
          </div>
          <button
            type="button" onClick={onClose} className="icon-btn" aria-label="Fechar"
            style={{ flexShrink: 0 }}
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <div style={{ padding: "1.15rem 1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          {children}
        </div>

        {footer && (
          <div
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)", flexWrap: "wrap",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
