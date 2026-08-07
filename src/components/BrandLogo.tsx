/** Assinatura da empresa dona do produto (login + sidebar).
 *  Vire para `false` para ocultar nos dois lugares de uma vez. */
export const SHOW_BRAND_OWNER: boolean = true;
export const BRAND_OWNER = "4YOU SMART SOLUTIONS";

/** Assinatura da dona do produto. Componente para sair igual no login e na barra. */
export function BrandOwnerSignature() {
  return <>{BRAND_OWNER}</>;
}

export function BrandLogo({
  size = 28,
  radius = 8,
  glow = false,
}: {
  size?: number;
  radius?: number;
  /** halo de acento — usar no login e em superfícies escuras */
  glow?: boolean;
}) {
  const icon = Math.round(size * 0.56);
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "var(--mh-brand-gradient)",
        boxShadow: glow ? "var(--mh-brand-glow)" : undefined,
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
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="7" height="9" rx="1.4" />
        <rect x="14" y="3" width="7" height="5" rx="1.4" />
        <rect x="14" y="12" width="7" height="9" rx="1.4" />
        <rect x="3" y="16" width="7" height="5" rx="1.4" />
      </svg>
    </span>
  );
}

/** Wordmark com texto em gradiente — usar ao lado do BrandLogo. */
export function BrandWordmark({ size = "1.05rem" }: { size?: string }) {
  return (
    <span
      style={{
        fontWeight: 800,
        fontSize: size,
        letterSpacing: "-0.02em",
        background: "var(--mh-brand-gradient)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        whiteSpace: "nowrap",
      }}
    >
      MANAGER HUB
    </span>
  );
}
