export function BrandLogo({
  size = 28,
  radius = 7,
}: {
  size?: number;
  radius?: number;
}) {
  const icon = Math.round(size * 0.6);
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "var(--primary)",
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
      aria-hidden
    >
      {/* painel de gestão / central de controle */}
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    </span>
  );
}
