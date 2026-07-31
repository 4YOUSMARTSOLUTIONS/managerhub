"use client";

import { createRoot } from "react-dom/client";
import { AlertTriangle } from "lucide-react";

type ConfirmOpts = {
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
};

/**
 * Substituto do window.confirm(): diálogo com os tokens do design system.
 * Uso: `if (!(await confirmDialog({ message: "..." }))) return;`
 */
export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    const close = (result: boolean) => {
      resolve(result);
      // desmonta fora do ciclo de render
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        document.removeEventListener("keydown", onKey);
        close(false);
      }
    };
    document.addEventListener("keydown", onKey);

    const dismiss = (result: boolean) => {
      document.removeEventListener("keydown", onKey);
      close(result);
    };

    root.render(<ConfirmOverlay opts={opts} onDone={dismiss} />);
  });
}

function ConfirmOverlay({ opts, onDone }: { opts: ConfirmOpts; onDone: (v: boolean) => void }) {
  const danger = opts.tone !== "primary";
  const accent = danger ? "var(--mh-danger)" : "var(--mh-primary-500)";

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => onDone(false)}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "14vh 1rem",
        zIndex: 90,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: "100%", maxWidth: 430, boxShadow: "var(--mh-shadow-e3)", overflow: "hidden" }}
      >
        <div style={{ padding: "1.35rem 1.35rem 0.75rem", display: "flex", gap: "0.9rem" }}>
          <div
            aria-hidden
            style={{
              width: 40,
              height: 40,
              flexShrink: 0,
              borderRadius: "var(--mh-radius-sm)",
              display: "grid",
              placeItems: "center",
              color: accent,
              background: `color-mix(in srgb, ${accent} 13%, transparent)`,
              border: `1px solid color-mix(in srgb, ${accent} 26%, transparent)`,
            }}
          >
            <AlertTriangle size={19} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>
              {opts.title ?? "Confirmar ação"}
            </h2>
            <div className="muted" style={{ fontSize: "0.88rem", marginTop: "0.4rem", lineHeight: 1.5 }}>
              {opts.message}
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.6rem",
            padding: "0.9rem 1.35rem 1.2rem",
          }}
        >
          <button type="button" className="btn btn-ghost" onClick={() => onDone(false)}>
            {opts.cancelLabel ?? "Cancelar"}
          </button>
          <button
            type="button"
            autoFocus
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            onClick={() => onDone(true)}
          >
            {opts.confirmLabel ?? "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
