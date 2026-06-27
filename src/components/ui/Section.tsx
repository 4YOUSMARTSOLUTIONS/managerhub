export function Section({
  title,
  action,
  children,
  padded = true,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  padded?: boolean;
}) {
  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.9rem 1.1rem",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>{title}</h2>
        {action}
      </div>
      <div style={padded ? { padding: "1.1rem" } : undefined}>{children}</div>
    </div>
  );
}
