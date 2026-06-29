"use client";

import { useEffect, useState } from "react";

const pad = (n: number) => String(n).padStart(2, "0");

/** Cronômetro ao vivo: mostra HH:MM:SS desde `startedAt`, atualizando a cada segundo. */
export function ElapsedTimer({ startedAt, style }: { startedAt: string; style?: React.CSSProperties }) {
  const start = new Date(startedAt).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const total = Math.max(0, Math.floor((now - start) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  return (
    <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, ...style }}>
      {h > 0 ? `${pad(h)}:` : ""}{pad(m)}:{pad(s)}
    </span>
  );
}
