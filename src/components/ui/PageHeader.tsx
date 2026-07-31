export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "1rem",
        marginBottom: "1.75rem",
        flexWrap: "wrap",
      }}
    >
      <div>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            margin: 0,
            letterSpacing: "-0.02em",
            color: "var(--mh-text-1)",
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="muted" style={{ margin: "0.3rem 0 0", fontSize: "0.9rem" }}>
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
