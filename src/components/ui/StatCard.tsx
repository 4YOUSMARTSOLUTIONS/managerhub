import type { Tone } from "@/lib/constants";

/** cada tom aponta para um token semântico — tema-aware por construção */
const TONE_VAR: Record<Tone, string> = {
  blue: "var(--mh-info)",
  green: "var(--mh-success)",
  amber: "var(--mh-warning)",
  red: "var(--mh-danger)",
  purple: "var(--mh-primary-500)",
  gray: "var(--mh-text-2)",
  dark: "var(--mh-text-1)",
  pink: "var(--mh-accent-500)",
};

export function StatCard({
  label,
  value,
  hint,
  tone = "blue",
  icon,
  delta,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: Tone;
  /** ícone Lucide, renderizado num tile tintado */
  icon?: React.ReactNode;
  /** variação percentual: positivo = verde, negativo = vermelho */
  delta?: number;
}) {
  const c = TONE_VAR[tone];
  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
        <div
          className="soft"
          style={{ fontSize: "0.69rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}
        >
          {label}
        </div>
        {icon && (
          <div
            aria-hidden
            style={{
              width: 34,
              height: 34,
              flexShrink: 0,
              borderRadius: "var(--mh-radius-sm)",
              display: "grid",
              placeItems: "center",
              color: c,
              background: `color-mix(in srgb, ${c} 13%, transparent)`,
              border: `1px solid color-mix(in srgb, ${c} 24%, transparent)`,
            }}
          >
            {icon}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", flexWrap: "wrap" }}>
        <div
          className="tabular"
          style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--mh-text-1)", lineHeight: 1, letterSpacing: "-0.02em" }}
        >
          {value}
        </div>
        {delta != null && delta !== 0 && (
          <span
            className="tabular"
            style={{
              fontSize: "0.78rem",
              fontWeight: 700,
              color: delta > 0 ? "var(--mh-success)" : "var(--mh-danger)",
            }}
          >
            {delta > 0 ? "↑" : "↓"} {Math.abs(delta)}%
          </span>
        )}
      </div>

      {hint && <div className="soft" style={{ fontSize: "0.78rem" }}>{hint}</div>}
    </div>
  );
}
