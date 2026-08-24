"use client";

import { shortName, formatDate } from "@/lib/format";
import { dataLocal, diasDoPeriodo } from "@/lib/ferias";

export type TimelineLinha = {
  userId: string;
  nome: string | null;
  itens: { inicio: string; fim: string; tipo: "efetivada" | "prevista" | string }[];
};

/**
 * A linha do tempo das férias: os próximos meses em colunas, uma linha por
 * colaborador, barras posicionadas por porcentagem. Efetivada sai cheia,
 * prevista sai clara: sobreposição de equipe se enxerga de relance, que é o
 * que um calendário mensal não mostra para períodos longos.
 *
 * CSS puro, sem lib: a conta é (dias desde o início da janela) / (dias da
 * janela), e só.
 */
export function FeriasTimeline({
  linhas, janelaInicio, janelaFim, hoje,
}: {
  linhas: TimelineLinha[];
  janelaInicio: string;
  janelaFim: string;
  hoje: string;
}) {
  if (linhas.length === 0) return null;

  const totalDias = diasDoPeriodo(janelaInicio, janelaFim);
  const pct = (iso: string) =>
    Math.min(100, Math.max(0, ((diasDoPeriodo(janelaInicio, iso) - 1) / totalDias) * 100));

  const meses: { label: string; leftPct: number }[] = [];
  const cursor = dataLocal(janelaInicio);
  const fim = dataLocal(janelaFim);
  while (cursor <= fim) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-01`;
    meses.push({
      label: cursor.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
      leftPct: pct(iso),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const hojePct = pct(hoje);

  return (
    <div className="card card-pad">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
        <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: 0 }}>Linha do tempo</h3>
        <span className="soft" style={{ fontSize: "0.74rem", display: "flex", gap: "0.9rem", alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
            <span style={{ width: 14, height: 8, borderRadius: 3, background: "var(--mh-success)" }} /> efetivada
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
            <span style={{ width: 14, height: 8, borderRadius: 3, background: "color-mix(in srgb, var(--mh-info) 45%, transparent)", border: "1px solid var(--mh-info)" }} /> prevista
          </span>
        </span>
      </div>

      <div style={{ overflowX: "auto", marginTop: "0.7rem" }}>
        <div style={{ minWidth: 640 }}>
          {/* régua dos meses */}
          <div style={{ position: "relative", height: 18, marginLeft: 140 }}>
            {meses.map((m) => (
              <span
                key={m.label + m.leftPct}
                className="soft"
                style={{
                  position: "absolute", left: `${m.leftPct}%`, fontSize: "0.68rem",
                  fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
                }}
              >
                {m.label}
              </span>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            {linhas.map((l) => (
              <div key={l.userId} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ width: 132, flexShrink: 0, fontSize: "0.8rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {shortName(l.nome)}
                </span>
                <div style={{ position: "relative", flex: 1, height: 20, background: "var(--surface-2)", borderRadius: 6 }}>
                  {meses.map((m) => (
                    <span
                      key={`g${m.leftPct}`}
                      aria-hidden
                      style={{ position: "absolute", left: `${m.leftPct}%`, top: 0, bottom: 0, borderLeft: "1px solid var(--border)" }}
                    />
                  ))}
                  <span
                    aria-hidden
                    style={{ position: "absolute", left: `${hojePct}%`, top: -2, bottom: -2, borderLeft: "2px solid var(--mh-danger)", opacity: 0.55 }}
                  />
                  {l.itens.map((it, i) => {
                    const left = pct(it.inicio);
                    const right = pct(it.fim);
                    const width = Math.max(right - left, 0.8);
                    return (
                      <span
                        key={i}
                        title={`${formatDate(it.inicio)} a ${formatDate(it.fim)} (${it.tipo === "efetivada" ? "efetivada" : "prevista"})`}
                        style={{
                          position: "absolute", left: `${left}%`, width: `${width}%`,
                          top: 4, height: 12, borderRadius: 5,
                          background: it.tipo === "efetivada"
                            ? "var(--mh-success)"
                            : "color-mix(in srgb, var(--mh-info) 45%, transparent)",
                          border: it.tipo === "efetivada" ? "none" : "1px solid var(--mh-info)",
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
