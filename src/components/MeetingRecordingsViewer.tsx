"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { getRecordings, getRecordingUrl, type RecordingRow } from "@/lib/actions/meeting-recordings";
import { RECORDING_STATUS_LABEL, RECORDING_STATUS_TONE } from "@/lib/constants";
import { Badge } from "@/components/ui/Badge";
import { formatDuration } from "@/lib/format";

export function MeetingRecordingsViewer({
  occurrenceId,
  title,
  onClose,
}: {
  occurrenceId: string;
  title: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<RecordingRow[] | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [, startTx] = useTransition();

  useEffect(() => {
    let alive = true;
    void getRecordings(occurrenceId).then((r) => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, [occurrenceId]);

  const play = (rec: RecordingRow) => {
    startTx(async () => {
      const url = await getRecordingUrl(rec.path);
      if (!url) { toast.error("Não foi possível abrir o áudio."); return; }
      window.open(url, "_blank", "noopener");
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 560, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <div>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>🎙 Gravações da reunião</h2>
            <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.85rem" }}>{title}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {rows === null ? (
            <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Carregando…</p>
          ) : rows.length === 0 ? (
            <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Nenhuma gravação nesta reunião.</p>
          ) : (
            rows.map((rec) => (
              <div key={rec.id} style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.6rem 0.8rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                  <div style={{ fontSize: "0.84rem", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {rec.source === "upload" ? "Arquivo enviado" : "Gravação"}
                    {rec.durationSeconds ? ` · ${formatDuration(rec.durationSeconds)}` : ""}
                  </div>
                  <Badge tone={RECORDING_STATUS_TONE[rec.status]}>{RECORDING_STATUS_LABEL[rec.status]}</Badge>
                </div>

                {rec.status === "falha" && rec.error && (
                  <p style={{ color: "var(--mh-danger)", fontSize: "0.76rem", margin: 0 }}>{rec.error}</p>
                )}

                {rec.status === "concluida" && rec.transcript && (
                  <div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded((e) => ({ ...e, [rec.id]: !e[rec.id] }))}>
                      {expanded[rec.id] ? "Ocultar transcrição" : "Ver transcrição"}
                    </button>
                    {expanded[rec.id] && (
                      <div style={{ marginTop: "0.4rem", fontSize: "0.8rem", whiteSpace: "pre-wrap", background: "var(--surface)", borderRadius: 8, padding: "0.55rem 0.7rem", maxHeight: 260, overflowY: "auto", lineHeight: 1.5 }}>
                        {rec.transcript}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => play(rec)}>Ouvir</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
