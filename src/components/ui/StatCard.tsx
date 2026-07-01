import type { Tone } from "@/lib/constants";

export function StatCard({
  label,
  value,
  hint,
  tone = "blue",
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: Tone;
}) {
  const colors: Record<Tone, string> = {
    blue: "#4f46e5",
    green: "#059669",
    amber: "#d97706",
    red: "#dc2626",
    purple: "#7c3aed",
    gray: "#4b5563",
    dark: "#1f2937",
    pink: "#be185d",
  };
  return (
    <div className="card card-pad">
      <div
        className="muted"
        style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.4rem" }}
      >
        {label}
      </div>
      <div
        style={{ fontSize: "1.9rem", fontWeight: 700, color: colors[tone], lineHeight: 1 }}
      >
        {value}
      </div>
      {hint && (
        <div className="soft" style={{ fontSize: "0.78rem", marginTop: "0.4rem" }}>
          {hint}
        </div>
      )}
    </div>
  );
}
