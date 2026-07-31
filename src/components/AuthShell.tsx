import { BrandLogo, BrandWordmark, BRAND_OWNER, SHOW_BRAND_OWNER } from "./BrandLogo";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        position: "relative",
        overflow: "hidden",
        background: "var(--mh-bg)",
      }}
    >
      {/* halos de acento — profundidade sem sombra pesada */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(680px circle at 22% 8%, color-mix(in srgb, var(--mh-accent-500) 16%, transparent), transparent 62%)," +
            "radial-gradient(620px circle at 82% 92%, color-mix(in srgb, var(--mh-primary-500) 18%, transparent), transparent 62%)",
        }}
      />

      <div style={{ width: "100%", maxWidth: 408, position: "relative" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.85rem",
            marginBottom: "1.75rem",
          }}
        >
          <BrandLogo size={52} radius={14} glow />
          <div style={{ textAlign: "center" }}>
            <BrandWordmark size="1.35rem" />
            {SHOW_BRAND_OWNER && (
              <div
                style={{
                  fontSize: "0.6rem",
                  fontWeight: 700,
                  letterSpacing: "0.16em",
                  color: "var(--mh-text-3)",
                  marginTop: 3,
                }}
              >
                {BRAND_OWNER}
              </div>
            )}
          </div>
        </div>

        <div
          className="card"
          style={{
            padding: "1.6rem",
            boxShadow: "var(--mh-shadow-e3)",
            borderRadius: "var(--mh-radius-lg)",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 0.3rem", letterSpacing: "-0.01em" }}>
            {title}
          </h1>
          {subtitle && (
            <p className="muted" style={{ margin: "0 0 1.35rem", fontSize: "0.875rem" }}>
              {subtitle}
            </p>
          )}
          {children}
        </div>

        {footer && (
          <p className="muted" style={{ textAlign: "center", marginTop: "1rem", fontSize: "0.875rem" }}>
            {footer}
          </p>
        )}
      </div>
    </div>
  );
}
