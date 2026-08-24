import type { Tone } from "@/lib/constants";

/**
 * A pílula de estado, em dois níveis de voz.
 *
 * `tint` (padrão) é a pílula tintada de sempre: fundo, borda e texto na cor
 * semântica. É reservada a STATUS que pede ação — em apuração, atrasado,
 * aguardando triagem.
 *
 * `quiet` é o nível neutro: corpo cinza e a cor do tom reduzida a um ponto de
 * 6px. É o nível de taxonomia e cadastro — classe, tipo, natureza, perfil,
 * ativo/inativo. A regra do produto é UMA pílula tintada por linha; o resto
 * fala baixo. Ver DESIGN.md.
 */
export function Badge({
  children,
  tone = "gray",
  variant = "tint",
}: {
  children: React.ReactNode;
  tone?: Tone;
  variant?: "tint" | "quiet";
}) {
  return (
    <span className={`badge badge-${tone}${variant === "quiet" ? " badge-quiet" : ""}`}>
      {children}
    </span>
  );
}
