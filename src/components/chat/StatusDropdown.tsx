"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { STATUS_COR, STATUS_ROTULO } from "./ChatPresenceProvider";
import type { Enums } from "@/types/database";

/**
 * O dropdown de disponibilidade: pílula com a bolinha da cor do status e as
 * opções coloridas dentro, no lugar de um select nativo (que não aceita cor).
 * Usado na coluna do chat e no menu do usuário.
 */
export function StatusDropdown({
  status, onMudar,
}: {
  status: Enums<"chat_user_status">;
  onMudar: (s: Enums<"chat_user_status">) => void;
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

  return (
    <div ref={ref} style={{ position: "relative", display: "flex" }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-label="Status no chat"
        onClick={() => setAberto((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: "0.4rem",
          padding: "0.3rem 0.55rem", fontSize: "0.8rem", cursor: "pointer",
          background: "var(--mh-surface-2)", border: "1px solid var(--mh-border)",
          borderRadius: "var(--mh-radius-md)", color: "var(--mh-text-1)", whiteSpace: "nowrap",
        }}
      >
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COR[status], flexShrink: 0 }} />
        {STATUS_ROTULO[status]}
        <ChevronDown size={13} style={{ color: "var(--mh-text-3)", transform: aberto ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {aberto && (
        <div
          role="listbox"
          style={{
            // zIndex acima do menu do usuário (60): o dropdown vive dentro dele
            position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 70, minWidth: 150,
            background: "var(--mh-surface-1)", border: "1px solid var(--mh-border)",
            borderRadius: "var(--mh-radius-md)", boxShadow: "var(--mh-shadow-e2)",
            padding: "0.3rem", display: "flex", flexDirection: "column", gap: "0.05rem",
          }}
        >
          {(["disponivel", "ocupado", "ausente"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="option"
              aria-selected={status === s}
              onClick={() => { setAberto(false); onMudar(s); }}
              style={{
                display: "flex", alignItems: "center", gap: "0.5rem", width: "100%",
                padding: "0.4rem 0.6rem", background: "none", border: "none",
                borderRadius: "var(--mh-radius-sm)", fontSize: "0.8rem", cursor: "pointer",
                textAlign: "left", color: "var(--mh-text-1)", whiteSpace: "nowrap",
                fontWeight: status === s ? 600 : 400,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--mh-surface-2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COR[s], flexShrink: 0 }} />
              {STATUS_ROTULO[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
