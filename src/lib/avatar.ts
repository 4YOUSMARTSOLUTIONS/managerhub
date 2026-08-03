/**
 * Foto de perfil: bucket, limites e montagem da URL.
 *
 * O bucket `avatars` é o único PÚBLICO do projeto. Os outros 6 são privados com
 * signed URL de 10 minutos, o que não serve aqui: a foto aparece em toda tela que
 * mostra avatar, então seria uma chamada de assinatura por linha de lista, sem
 * cache e com a inicial piscando antes de cada foto.
 *
 * A URL é montada aqui e em nenhum outro lugar. Se um dia a foto precisar voltar a
 * ser privada, troca-se o corpo de `avatarSrc` por um proxy autenticado e nenhum
 * dos pontos de renderização muda.
 */

export const AVATAR_BUCKET = "avatars";

/** Mesmo limite declarado no bucket; validado também no servidor. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Lado do quadrado gravado. O avatar é exibido no máximo a 34px, então 256 cobre retina com folga. */
export const AVATAR_SIZE = 256;

/** `path` é o caminho dentro do bucket (`{user_id}/{token}.webp`), não uma URL. */
export function avatarSrc(path: string | null | undefined): string | null {
  const p = path?.trim();
  if (!p) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${AVATAR_BUCKET}/${p}`;
}
