"use client";

import { useState } from "react";
import { Info } from "lucide-react";

/** Ícone de ajuda com balão (tooltip). Aparece só no hover/foco. */
export function InfoHint({
  children,
  label = "Ajuda",
  size = 14,
}: {
  children: React.ReactNode;
  label?: string;
  size?: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <span
      style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          background: "none",
          padding: 0,
          cursor: "help",
          color: open ? "var(--mh-primary-500)" : "var(--mh-text-3)",
          transition: "color 0.15s",
        }}
      >
        <Info size={size} />
      </button>

      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            left: 0,
            top: "calc(100% + 6px)",
            zIndex: 50,
            width: "max-content",
            maxWidth: 320,
            background: "var(--mh-surface-1)",
            border: "1px solid var(--mh-border)",
            boxShadow: "var(--mh-shadow-e2)",
            borderRadius: "var(--mh-radius-md)",
            padding: "0.7rem 0.85rem",
            fontSize: "0.78rem",
            fontWeight: 400,
            textTransform: "none",
            letterSpacing: "normal",
            lineHeight: 1.5,
            color: "var(--mh-text-2)",
          }}
        >
          {children}
        </span>
      )}
    </span>
  );
}
