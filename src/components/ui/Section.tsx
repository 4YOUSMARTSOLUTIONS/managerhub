export function Section({
  title,
  action,
  children,
  padded = true,
  bodyStyle,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  padded?: boolean;
  /** estilo extra no corpo; usado para esmaecer a lista enquanto ela atualiza */
  bodyStyle?: React.CSSProperties;
}) {
  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          padding: "1rem 1.25rem",
          borderBottom: "1px solid var(--mh-border)",
        }}
      >
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>{title}</h2>
        {action}
      </div>
      <div style={{ ...(padded ? { padding: "1.25rem" } : { overflowX: "auto" }), ...bodyStyle }}>{children}</div>
    </div>
  );
}
