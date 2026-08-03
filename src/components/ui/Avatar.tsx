"use client";

import { useState } from "react";
import { initials } from "@/lib/format";
import { avatarSrc } from "@/lib/avatar";
import { useAvatars } from "@/components/AvatarProvider";

/**
 * Bolinha da pessoa: foto quando houver, iniciais quando não.
 *
 * A foto é buscada pelo `userId` no mapa do contexto, então quem renderiza só
 * precisa informar quem é a pessoa. `path` existe para o caso de já se ter o
 * caminho em mãos (a pré-visualização em Meu perfil, antes de salvar).
 */
export function Avatar({
  name,
  userId,
  path,
  size,
}: {
  name: string | null | undefined;
  userId?: string | null;
  path?: string | null;
  /** lado em px; sem isso vale o tamanho da classe .avatar (e o override das tabelas) */
  size?: number;
}) {
  const { byUser } = useAvatars();
  const [quebrou, setQuebrou] = useState(false);

  const src = avatarSrc(path ?? (userId ? byUser[userId] : null));
  const style = size ? { width: size, height: size, fontSize: Math.round(size * 0.36) } : undefined;

  if (src && !quebrou) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 20 KB servidos do storage; next/image exigiria remotePatterns e não compensa
      <img
        className="avatar"
        src={src}
        alt=""
        title={name ?? undefined}
        loading="lazy"
        style={style}
        // objeto apagado fora do fluxo viraria ícone de imagem quebrada em toda tela
        onError={() => setQuebrou(true)}
      />
    );
  }

  return (
    <span className="avatar" title={name ?? undefined} style={style}>
      {initials(name)}
    </span>
  );
}
