import type { Tone } from "@/lib/constants";
import { InfoHint } from "@/components/ui/InfoHint";

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
  destaque,
  onClick,
  acao,
  dica,
}: {
  label: string;
  /** o número do cartão; um nó quando o cartão mostra mais de um número (ex.: alertas e sem tratativa) */
  value: React.ReactNode;
  hint?: string;
  tone?: Tone;
  /** ícone Lucide, renderizado num tile tintado */
  icon?: React.ReactNode;
  /** variação percentual: positivo = verde, negativo = vermelho */
  delta?: number;
  /**
   * Pinta o cartão inteiro com o tom, em transparência, para chamar atenção
   * (ex.: bloqueios da blitz). Só para o que pede ação, e só quando há o que ver.
   */
  destaque?: Tone;
  /** cartão clicável (ex.: leva à lista filtrada); abre também com Enter/espaço */
  onClick?: () => void;
  /** o que o clique faz, para o leitor de tela e o title (ex.: "Ver as blitz bloqueadas") */
  acao?: string;
  /** explicação do número: ícone de informação ao lado do título, com balão */
  dica?: React.ReactNode;
}) {
  const c = TONE_VAR[tone];
  const d = destaque ? TONE_VAR[destaque] : null;
  // no cartão pintado o texto segue o tema: branco no escuro (globals.css)
  const corTexto = d ? "var(--mh-texto-destaque)" : "var(--mh-text-1)";
  const corSuave = d ? { color: "var(--mh-texto-destaque-suave)" } : undefined;
  return (
    <div
      className="card card-pad"
      {...(onClick ? {
        role: "button", tabIndex: 0, title: acao, "aria-label": acao ? `${label}: ${acao}` : label, onClick,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } },
      } : {})}
      style={{
        display: "flex", flexDirection: "column", gap: "0.85rem",
        ...(onClick ? { cursor: "pointer" } : {}),
        ...(d ? {
          background: `color-mix(in srgb, ${d} 18%, var(--surface))`,
          borderColor: `color-mix(in srgb, ${d} 55%, transparent)`,
        } : {}),
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", minWidth: 0 }}>
          <div
            className="soft"
            style={{ fontSize: "0.69rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", ...corSuave }}
          >
            {label}
          </div>
          {/* fora do título em caixa alta: o balão não herda a caixa alta nem a letra miúda */}
          {dica && <InfoHint label={`Sobre ${label.toLowerCase()}`} size={13}>{dica}</InfoHint>}
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
          style={{ fontSize: "1.6rem", fontWeight: 700, color: corTexto, lineHeight: 1, letterSpacing: "-0.02em" }}
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

      {hint && <div className="soft" style={{ fontSize: "0.78rem", ...corSuave }}>{hint}</div>}
    </div>
  );
}
