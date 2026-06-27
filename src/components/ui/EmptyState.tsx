export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "3rem 1.5rem",
        color: "var(--text-muted)",
      }}
    >
      <p style={{ fontWeight: 600, color: "var(--text)", margin: 0 }}>{title}</p>
      {description && (
        <p style={{ margin: "0.4rem 0 1rem", fontSize: "0.9rem" }}>
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
