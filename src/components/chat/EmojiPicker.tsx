"use client";

import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";

/**
 * Seletor de emoji do chat.
 *
 * Lista curada e escrita à mão, sem biblioteca: um pacote de emoji traz
 * megabytes de dados e imagens, e a CSP dos anexos não deixaria buscar sprite
 * de CDN. O sistema já usa a fonte do sistema operacional para desenhar os
 * caracteres, então o que falta é só o atalho para digitar.
 */
const GRUPOS: { nome: string; itens: string[] }[] = [
  {
    nome: "Rostos",
    itens: [
      "😀", "😁", "😂", "🤣", "😊", "😇", "🙂", "😉", "😍", "😘",
      "😎", "🤩", "🤔", "🤨", "😐", "😴", "😮", "😢", "😭", "😅",
      "😬", "🙄", "😳", "😤", "😡", "🥳", "🤝", "🙏", "💪", "🫡",
    ],
  },
  {
    nome: "Reações",
    itens: [
      "👍", "👎", "👏", "🙌", "👌", "✌️", "🤞", "☝️", "✋", "🤙",
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🔥", "✨", "🎉", "🎊",
      "⭐", "💯", "✅", "❌", "⚠️", "❗", "❓", "💡", "👀", "🚀",
    ],
  },
  {
    nome: "Trabalho",
    itens: [
      "📅", "📌", "📎", "📝", "📄", "📊", "📈", "📉", "🗂️", "📁",
      "💼", "🏭", "🚚", "🧰", "🔧", "⚙️", "🦺", "⛑️", "🧯", "🚧",
      "⏰", "⏳", "☕", "🍽️", "💰", "🧾", "🖥️", "📱", "☎️", "📧",
    ],
  },
];

export function EmojiPicker({
  onEscolher,
  disabled = false,
}: {
  onEscolher: (emoji: string) => void;
  disabled?: boolean;
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
        className="btn btn-ghost btn-sm"
        title="Emoji"
        aria-label="Escolher emoji"
        aria-expanded={aberto}
        disabled={disabled}
        onClick={() => setAberto((v) => !v)}
      >
        <Smile size={15} />
      </button>

      {aberto && (
        <div
          role="dialog"
          aria-label="Emojis"
          style={{
            position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 60,
            width: 268, maxHeight: 260, overflowY: "auto",
            background: "var(--mh-surface-1)", border: "1px solid var(--mh-border)",
            borderRadius: "var(--mh-radius-md)", boxShadow: "var(--mh-shadow-e2)",
            padding: "0.5rem",
          }}
        >
          {GRUPOS.map((g) => (
            <div key={g.nome} style={{ marginBottom: "0.4rem" }}>
              <div className="soft" style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.04em", padding: "0.15rem 0.2rem 0.3rem" }}>
                {g.nome}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}>
                {g.itens.map((e) => (
                  <button
                    key={e}
                    type="button"
                    title={e}
                    onClick={() => { onEscolher(e); setAberto(false); }}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      fontSize: "1.15rem", lineHeight: 1, padding: "0.2rem",
                      borderRadius: "var(--mh-radius-sm)",
                    }}
                    onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--mh-surface-2)")}
                    onMouseLeave={(ev) => (ev.currentTarget.style.background = "none")}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
