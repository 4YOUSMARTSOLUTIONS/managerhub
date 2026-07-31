"use client";

import { Badge } from "@/components/ui/Badge";
import { PERIODICITY } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { SeriesData } from "./SeriesDialog";
import type { Person } from "./PeoplePicker";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="soft" style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: "0.86rem", marginTop: 2, whiteSpace: "pre-wrap" }}>{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: "0.4rem" }}>{title}</div>
      {children}
    </div>
  );
}

/** Lista numerada com o número renderizado explicitamente (não depende do marcador do navegador). */
function NumberedList({ items }: { items: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      {items.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: "0.5rem", fontSize: "0.86rem" }}>
          <span className="soft" style={{ fontVariantNumeric: "tabular-nums", minWidth: "1.3rem", textAlign: "right", flexShrink: 0 }}>{i + 1}.</span>
          <span>{r}</span>
        </div>
      ))}
    </div>
  );
}

/** Visualização somente-leitura de tudo que está cadastrado numa reunião (TOR). */
export function SeriesViewDialog({
  series,
  people,
  unitCount,
  durationLabel,
  onClose,
}: {
  series: SeriesData;
  people: Person[];
  unitCount: number;
  durationLabel: string;
  onClose: () => void;
}) {
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const participantNames = series.participantIds.map((id) => nameById.get(id) ?? "—");
  const ownerName = series.ownerUserName ?? (series.ownerUserId ? nameById.get(series.ownerUserId) : null) ?? series.owner ?? "—";
  const unitsLabel = series.unitNames.length === 0
    ? "—"
    : unitCount > 0 && series.unitNames.length === unitCount
      ? "Todas as unidades"
      : series.unitNames.join(", ");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 680, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", gap: "0.75rem" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{series.name}</h2>
              {series.isPrivate && <Badge tone="amber">Privada</Badge>}
              {series.isOnline && <Badge tone="blue">Online</Badge>}
            </div>
            <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.85rem" }}>{PERIODICITY[series.periodicity as keyof typeof PERIODICITY] ?? series.periodicity}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)", flexShrink: 0 }}>×</button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          {series.objetivo && <Section title="Objetivo"><div style={{ fontSize: "0.88rem", whiteSpace: "pre-wrap" }}>{series.objetivo}</div></Section>}

          <div style={{ background: "var(--surface-2)", borderRadius: 9, padding: "0.85rem 1rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.8rem" }}>
            <Field label="Dono / responsável">{ownerName}</Field>
            <Field label="Duração prevista">{durationLabel}</Field>
            <Field label="Próxima ocorrência">{series.nextDate ? `${formatDate(series.nextDate)}${series.startTime ? " " + series.startTime.slice(0, 5) : ""}` : "—"}</Field>
            <Field label="Sala">{series.isOnline ? "Online" : (series.roomName ?? "—")}</Field>
            <Field label="Unidades">{unitsLabel}</Field>
            <Field label="Reserva automática">{series.autoBook ? "Sim" : "Não"}</Field>
          </div>

          <Section title={`Participantes · ${participantNames.length}`}>
            {participantNames.length === 0 && !series.participantsText ? (
              <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Sem participantes cadastrados.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                {participantNames.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>{participantNames.map((n, i) => <Badge key={i} tone="gray">{n}</Badge>)}</div>}
                {series.participantsText && <div className="muted" style={{ fontSize: "0.83rem", whiteSpace: "pre-wrap" }}>{series.participantsText}</div>}
              </div>
            )}
          </Section>

          {series.generalRules.filter(Boolean).length > 0 && (
            <Section title="Regras gerais">
              <NumberedList items={series.generalRules.filter(Boolean)} />
            </Section>
          )}

          {series.howTo.filter(Boolean).length > 0 && (
            <Section title="Como realizar">
              <NumberedList items={series.howTo.filter(Boolean)} />
            </Section>
          )}

          <Section title={`Conteúdo / Pauta · ${series.content.length}`}>
            {series.content.length === 0 ? (
              <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Sem pauta cadastrada.</p>
            ) : (
              <table className="table">
                <thead><tr><th style={{ width: 36, textAlign: "right" }}>#</th><th>Item</th><th style={{ whiteSpace: "nowrap" }}>Tempo</th><th>Responsável</th></tr></thead>
                <tbody>
                  {series.content.map((c, i) => (
                    <tr key={i}>
                      <td className="soft" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{i + 1}</td>
                      <td>{c.item || "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{c.tempo || "—"}</td>
                      <td className="muted">{c.dono || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0.9rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
