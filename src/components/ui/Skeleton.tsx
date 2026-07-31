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

/** Placeholder de uma tela inteira (usar em loading.tsx). */
export function SkeletonPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }} aria-busy="true">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Skeleton width={220} height={28} />
        <Skeleton width={340} height={14} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "0.9rem" }}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} height={104} radius="var(--mh-radius-lg)" />
        ))}
      </div>
      <Skeleton height={320} radius="var(--mh-radius-lg)" />
    </div>
  );
}
