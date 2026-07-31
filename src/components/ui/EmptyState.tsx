import { Inbox } from "lucide-react";

export function EmptyState({
  title,
  description,
  action,
  icon,
  badge,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** ícone Lucide; usa Inbox se omitido */
  icon?: React.ReactNode;
  /** selo opcional acima do título (ex.: "Em breve") */
  badge?: string;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "3.5rem 1.5rem",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 56,
          height: 56,
          borderRadius: "var(--mh-radius-lg)",
          display: "grid",
          placeItems: "center",
          marginBottom: "1rem",
          color: "var(--mh-primary-500)",
          background: "var(--mh-primary-soft)",
          border: "1px solid color-mix(in srgb, var(--mh-primary-500) 22%, transparent)",
        }}
      >
        {icon ?? <Inbox size={24} />}
      </div>

      {badge && (
        <span className="badge badge-purple badge-dot" style={{ marginBottom: "0.6rem" }}>
          {badge}
        </span>
      )}

      <p style={{ fontWeight: 700, color: "var(--mh-text-1)", margin: 0, fontSize: "1rem" }}>
        {title}
      </p>
      {description && (
        <p
          className="muted"
          style={{ margin: "0.35rem 0 0", fontSize: "0.875rem", maxWidth: 420, lineHeight: 1.5 }}
        >
          {description}
        </p>
      )}
      {action && <div style={{ marginTop: "1.1rem" }}>{action}</div>}
    </div>
  );
}
