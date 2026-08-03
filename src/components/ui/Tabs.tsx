"use client";

import { useState } from "react";

export type Tab = { id: string; label: string; content: React.ReactNode };

export function Tabs({
  tabs,
  variant = "default",
  initialId,
}: {
  tabs: Tab[];
  variant?: "default" | "sub";
  /** Aba aberta ao entrar na tela. Sem isso abre na primeira; id desconhecido cai na primeira. */
  initialId?: string;
}) {
  const [active, setActive] = useState(
    initialId && tabs.some((t) => t.id === initialId) ? initialId : tabs[0]?.id,
  );
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div>
      <div className={variant === "sub" ? "tabbar tabbar-sub" : "tabbar"}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${variant === "sub" ? "tab tab-pill" : "tab"}${t.id === active ? (variant === "sub" ? " tab-pill-active" : " tab-active") : ""}`}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>{current?.content}</div>
    </div>
  );
}
