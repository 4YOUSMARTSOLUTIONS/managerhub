"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { grupoFotoSrc } from "@/lib/avatar";

/** Bolinha do grupo: foto quando houver, ícone de pessoas quando não. */
export function GrupoAvatar({
  path,
  name,
  size = 34,
}: {
  path: string | null | undefined;
  name?: string | null;
  size?: number;
}) {
  const [quebrou, setQuebrou] = useState(false);
  const src = grupoFotoSrc(path);

  if (src && !quebrou) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- bucket público, mesmo racional do Avatar de pessoa
      <img
        src={src}
        alt=""
        title={name ?? undefined}
        loading="lazy"
        onError={() => setQuebrou(true)}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }

  return (
    <span
      title={name ?? undefined}
      style={{
        width: size, height: size, borderRadius: "50%", background: "var(--mh-surface-2)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}
    >
      <Users size={Math.round(size * 0.47)} />
    </span>
  );
}
