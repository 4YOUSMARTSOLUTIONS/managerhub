import { BrandLogo } from "./BrandLogo";

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
        background:
          "radial-gradient(900px circle at 20% 0%, #eef2ff, transparent), var(--bg)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              fontWeight: 800,
              fontSize: "1.25rem",
              letterSpacing: "-0.02em",
            }}
          >
            <BrandLogo size={30} radius={8} />
            MANAGER HUB
          </div>
        </div>
        <div className="card card-pad" style={{ boxShadow: "var(--shadow)" }}>
          <h1 style={{ fontSize: "1.2rem", fontWeight: 700, margin: "0 0 0.25rem" }}>
            {title}
          </h1>
          {subtitle && (
            <p className="muted" style={{ margin: "0 0 1.25rem", fontSize: "0.9rem" }}>
              {subtitle}
            </p>
          )}
          {children}
        </div>
        {footer && (
          <p
            className="muted"
            style={{ textAlign: "center", marginTop: "1rem", fontSize: "0.9rem" }}
          >
            {footer}
          </p>
        )}
      </div>
    </div>
  );
}
