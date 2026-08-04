export function Skeleton({
  width = "100%",
  height = 16,
  radius,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="skeleton"
      aria-hidden
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/** Bloco de linhas para listas/tabelas em carregamento. */
export function SkeletonRows({ rows = 5, height = 44 }: { rows?: number; height?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} radius="var(--mh-radius-sm)" />
      ))}
    </div>
  );
}

/**
 * Placeholder de uma tela inteira (usar em loading.tsx).
 *
 * Duas decisões de propósito, as duas contra o efeito "piscada cinza":
 *
 * 1. A forma é o ESQUELETO COMUM das telas, não um layout qualquer. Antes havia
 *    quatro cartões de indicador aqui, e a maioria das telas não tem cartão
 *    nenhum: o placeholder prometia uma coisa e chegava outra, e o salto era o
 *    que incomodava. Título, barra de filtros e um painel com linhas é o que
 *    praticamente toda tela do portal tem de fato. Linhas finas dentro de um
 *    painel com borda também pesam muito menos na tela do que blocos chapados.
 *
 * 2. `mh-deferred` atrasa a entrada em 80 ms, abaixo do que o olho registra.
 *    Navegação que resolve nesse tempo não mostra cinza nenhum.
 */
export function SkeletonPage() {
  return (
    <div
      className="mh-deferred"
      style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}
      aria-busy="true"
    >
      {/* cabeçalho da página */}
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <Skeleton width={210} height={24} radius="var(--mh-radius-sm)" />
        <Skeleton width={330} height={13} radius="var(--mh-radius-sm)" />
      </div>

      {/* barra de filtros/ações */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {[150, 118, 118, 96].map((w, i) => (
          <Skeleton key={i} width={w} height={34} radius="var(--mh-radius-sm)" />
        ))}
        <Skeleton width={112} height={34} radius="var(--mh-radius-sm)" style={{ marginLeft: "auto" }} />
      </div>

      {/* painel de conteúdo, com linhas em vez de um bloco chapado */}
      <div className="mh-skeleton-panel">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="mh-skeleton-line">
            <Skeleton width={26} height={26} radius="999px" />
            <Skeleton width={`${44 - i * 3}%`} height={12} />
            <Skeleton width={78} height={20} radius="999px" style={{ marginLeft: "auto" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
