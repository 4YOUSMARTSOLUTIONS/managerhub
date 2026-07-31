"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { getOccurrenceDetail, type OccurrenceDetail } from "@/lib/actions/meeting-records";
import { getRecordings, getRecordingUrl, type RecordingRow } from "@/lib/actions/meeting-recordings";
import {
  ACTION_STATUS, ACTION_STATUS_TONE, PRIORITY, PRIORITY_TONE,
  RECORDING_STATUS_LABEL, RECORDING_STATUS_TONE,
} from "@/lib/constants";
import { Badge } from "@/components/ui/Badge";
import { formatDate, formatDateTime, formatDuration } from "@/lib/format";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: "0.35rem" }}>{title}</div>
      {children}
    </div>
  );
}

function TextBlock({ value }: { value: string | null }) {
  if (!value || !value.trim()) return <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Sem registro.</p>;
  return (
    <div style={{ fontSize: "0.86rem", whiteSpace: "pre-wrap", background: "var(--surface-2)", borderRadius: 8, padding: "0.6rem 0.75rem", lineHeight: 1.5, maxHeight: 260, overflowY: "auto" }}>
      {value}
    </div>
  );
}

export function MeetingOccurrenceDetail({ occurrenceId, onClose }: { occurrenceId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<OccurrenceDetail | null>(null);
  const [recordings, setRecordings] = useState<RecordingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [, startTx] = useTransition();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([getOccurrenceDetail(occurrenceId), getRecordings(occurrenceId)]).then(([d, r]) => {
      if (!alive) return;
      setDetail(d);
      setRecordings(r);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [occurrenceId]);

  const play = (rec: RecordingRow) => {
    startTx(async () => {
      const url = await getRecordingUrl(rec.path);
      if (!url) { toast.error("Não foi possível abrir o áudio."); return; }
      window.open(url, "_blank", "noopener");
    });
  };

  const presentCount = detail ? detail.attendance.filter((a) => a.present).length : 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 640, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{detail?.seriesName ?? "Reunião"}</h2>
            <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.85rem" }}>
              {detail ? (detail.startedAt ? formatDateTime(detail.startedAt) : formatDate(detail.occurredOn)) : "Carregando…"}
              {detail && detail.status !== "cancelled" ? ` · ${formatDuration(detail.durationSeconds)}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.05rem" }}>
          {loading ? (
            <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Carregando…</p>
          ) : !detail ? (
            <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Não foi possível carregar o detalhe da reunião.</p>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", fontSize: "0.82rem" }}>
                {detail.status === "cancelled" && <Badge tone="red">Cancelada</Badge>}
                {detail.autoFinished && <Badge tone="amber">Finalização automática</Badge>}
                {detail.roomName && <Badge tone="blue">Sala: {detail.roomName}</Badge>}
                <span className="soft">Registrado por: {detail.registeredByName ?? "—"}</span>
              </div>
              {detail.meetingLink && (
                <div style={{ fontSize: "0.84rem" }}>
                  <span className="label" style={{ marginRight: "0.4rem" }}>Link:</span>
                  <a href={detail.meetingLink} target="_blank" rel="noopener noreferrer" style={{ color: "var(--mh-primary-600, var(--mh-info))", wordBreak: "break-all" }}>{detail.meetingLink}</a>
                </div>
              )}
              {detail.autoFinished && (
                <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
                  Esta reunião foi encerrada automaticamente pelo sistema por ultrapassar 3x o tempo previsto sem finalização manual.
                </p>
              )}

              <Section title={`Presença · ${presentCount}/${detail.attendance.length} presentes`}>
                {detail.attendance.length === 0 ? (
                  <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Sem registro de presença.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    {detail.attendance.map((a, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "0.2rem 0" }}>
                        <span>{a.name}</span>
                        <Badge tone={a.present ? "green" : "gray"}>{a.present ? "Presente" : "Ausente"}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Anotações"><TextBlock value={detail.notes} /></Section>
              <Section title="Decisões"><TextBlock value={detail.decisions} /></Section>
              <Section title="Transcrição"><TextBlock value={detail.transcript} /></Section>

              <Section title={`Ações abertas · ${detail.actions.length}`}>
                {detail.actions.length === 0 ? (
                  <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Nenhuma ação aberta nesta reunião.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {detail.actions.map((a) => (
                      <div key={a.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "0.55rem 0.7rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.35rem" }}>
                          {a.code != null && <span className="soft" style={{ fontSize: "0.78rem" }}>#{a.code}</span>}
                          {a.isSdpo && <Badge tone="purple">SDPO</Badge>}
                          <Badge tone={PRIORITY_TONE[a.priority]}>{PRIORITY[a.priority]}</Badge>
                          <span className="soft" style={{ fontSize: "0.78rem" }}>Solicitante: {a.requesterName ?? "—"}{a.dueDate ? ` · prazo ${formatDate(a.dueDate)}` : ""}</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                          {a.demandas.map((d) => (
                            <div key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", fontSize: "0.84rem" }}>
                              <span style={{ minWidth: 0 }}>
                                {d.description}
                                {d.assigneeNames.length > 0 && <span className="soft"> · {d.assigneeNames.join(", ")}</span>}
                              </span>
                              <Badge tone={ACTION_STATUS_TONE[d.status]}>{ACTION_STATUS[d.status]}</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title={`Gravações · ${recordings.length}`}>
                {recordings.length === 0 ? (
                  <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Nenhuma gravação.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                    {recordings.map((rec) => (
                      <div key={rec.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "0.5rem 0.7rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                          <span style={{ fontSize: "0.84rem", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {rec.source === "upload" ? "Arquivo enviado" : "Gravação"}{rec.durationSeconds ? ` · ${formatDuration(rec.durationSeconds)}` : ""}
                          </span>
                          <Badge tone={RECORDING_STATUS_TONE[rec.status]}>{RECORDING_STATUS_LABEL[rec.status]}</Badge>
                        </div>
                        {rec.status === "concluida" && rec.transcript && (
                          <div>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded((e) => ({ ...e, [rec.id]: !e[rec.id] }))}>
                              {expanded[rec.id] ? "Ocultar transcrição" : "Ver transcrição"}
                            </button>
                            {expanded[rec.id] && (
                              <div style={{ marginTop: "0.4rem", fontSize: "0.8rem", whiteSpace: "pre-wrap", background: "var(--surface-2)", borderRadius: 8, padding: "0.55rem 0.7rem", maxHeight: 220, overflowY: "auto", lineHeight: 1.5 }}>
                                {rec.transcript}
                              </div>
                            )}
                          </div>
                        )}
                        <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => play(rec)}>Ouvir</button></div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
