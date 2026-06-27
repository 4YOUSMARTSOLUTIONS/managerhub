"use client";

import { PERIODICITY } from "@/lib/constants";
import type { SeriesData } from "./SeriesDialog";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="soft" style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: "0.85rem", marginTop: 1 }}>{children}</div>
    </div>
  );
}

export function TorView({ series, participantNames }: { series: SeriesData; participantNames: string[] }) {
  const localLabel = series.roomName
    ? series.roomName + (series.isOnline ? " + Online" : "")
    : series.isOnline ? "Online" : null;
  const durLabel = series.durationMin != null
    ? `${series.durationMin} ${series.durationUnit === "h" ? "h" : "min"}`
    : null;
  const has =
    series.objetivo || series.owner || series.ownerUserName || localLabel || durLabel ||
    series.participantsText || series.content.length || series.generalRules.length ||
    series.howTo.length || participantNames.length;

  if (!has) return <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Sem TOR cadastrado para esta reunião.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      {series.objetivo && <Field label="Objetivo"><span className="muted" style={{ whiteSpace: "pre-wrap" }}>{series.objetivo}</span></Field>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "0.7rem" }}>
        {series.owner && <Field label="Dono">{series.owner}</Field>}
        {series.ownerUserName && <Field label="Responsável">{series.ownerUserName}</Field>}
        <Field label="Frequência">{PERIODICITY[series.periodicity as keyof typeof PERIODICITY]}</Field>
        {durLabel && <Field label="Duração">{durLabel}</Field>}
        {localLabel && <Field label="Local">{localLabel}</Field>}
        {series.unitNames.length > 0 && <Field label="Unidades">{series.unitNames.join(", ")}</Field>}
      </div>

      {series.participantsText && (
        <Field label="Participantes"><span className="muted">{series.participantsText}</span></Field>
      )}
      {participantNames.length > 0 && (
        <Field label="Usuários participantes"><span className="muted">{participantNames.join(", ")}</span></Field>
      )}

      {series.content.length > 0 && (
        <div>
          <div className="soft" style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 4 }}>Conteúdo / Pauta</div>
          <table className="table" style={{ fontSize: "0.82rem" }}>
            <thead><tr><th style={{ padding: "0.3rem 0.5rem" }}>Item</th><th style={{ padding: "0.3rem 0.5rem", width: 70 }}>Tempo</th><th style={{ padding: "0.3rem 0.5rem", width: 70 }}>Dono</th></tr></thead>
            <tbody>
              {series.content.map((c, i) => (
                <tr key={i}>
                  <td style={{ padding: "0.3rem 0.5rem" }}>{i + 1}. {c.item}</td>
                  <td style={{ padding: "0.3rem 0.5rem" }} className="muted">{c.tempo || "—"}</td>
                  <td style={{ padding: "0.3rem 0.5rem" }} className="muted">{c.dono || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {series.generalRules.length > 0 && (
        <Field label="Regras Gerais">
          <ol style={{ margin: "0.2rem 0 0", paddingLeft: "1.1rem" }} className="muted">
            {series.generalRules.map((r, i) => <li key={i} style={{ marginBottom: 2 }}>{r}</li>)}
          </ol>
        </Field>
      )}

      {series.howTo.length > 0 && (
        <Field label="Como Realizar">
          <ol style={{ margin: "0.2rem 0 0", paddingLeft: "1.1rem" }} className="muted">
            {series.howTo.map((r, i) => <li key={i} style={{ marginBottom: 2 }}>{r}</li>)}
          </ol>
        </Field>
      )}
    </div>
  );
}
