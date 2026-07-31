"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  uploadRecording,
  retranscribeRecording,
  getRecordings,
  getRecordingUrl,
  deleteRecording,
  type RecordingRow,
} from "@/lib/actions/meeting-recordings";
import { RECORDING_STATUS_LABEL, RECORDING_STATUS_TONE } from "@/lib/constants";
import { Badge } from "@/components/ui/Badge";
import { confirmDialog } from "@/components/ui/confirm";
import { formatDuration } from "@/lib/format";

function formatBytes(n: number | null): string {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function MeetingRecordingPanel({
  occurrenceId,
  onUseTranscript,
  onSaveTranscript,
}: {
  occurrenceId: string;
  onUseTranscript?: (transcript: string) => void;
  onSaveTranscript?: (transcript: string) => void;
}) {
  const [recordings, setRecordings] = useState<RecordingRow[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [, startTx] = useTransition();

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    const rows = await getRecordings(occurrenceId);
    setRecordings(rows);
    return rows;
  }, [occurrenceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // polling enquanto houver gravação em processamento
  useEffect(() => {
    const processing = recordings.some((r) => r.status === "processando" || r.status === "pendente");
    if (!processing) return;
    const id = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(id);
  }, [recordings, refresh]);

  // limpa o timer/stream ao desmontar
  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
    mediaRef.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const send = useCallback(async (file: File, source: string, duration: number | null) => {
    setBusy(true);
    const fd = new FormData();
    fd.append("occurrence_id", occurrenceId);
    fd.append("source", source);
    fd.append("file", file);
    if (duration != null) fd.append("duration_seconds", String(duration));
    const res = await uploadRecording(fd);
    setBusy(false);
    if (res.error) { toast.error(res.error); return; }
    toast.success("Áudio enviado, transcrição em andamento.");
    await refresh();
  }, [occurrenceId, refresh]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const duration = Math.round((Date.now() - startRef.current) / 1000);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const stamp = new Date().toLocaleString("sv-SE").replace(/[: ]/g, "-");
        const file = new File([blob], `gravacao-${stamp}.webm`, { type: "audio/webm" });
        void send(file, "gravacao", duration);
      };
      mediaRef.current = mr;
      startRef.current = Date.now();
      setElapsed(0);
      mr.start();
      setRecording(true);
      tickRef.current = setInterval(() => setElapsed(Math.round((Date.now() - startRef.current) / 1000)), 1000);
    } catch {
      toast.error("Não foi possível acessar o microfone. Verifique a permissão do navegador.");
    }
  };

  const stopRecording = () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    mediaRef.current?.stop();
    setRecording(false);
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("audio/")) { toast.error("Selecione um arquivo de áudio."); return; }
    void send(file, "upload", null);
  };

  const play = (rec: RecordingRow) => {
    startTx(async () => {
      const url = await getRecordingUrl(rec.path);
      if (!url) { toast.error("Não foi possível abrir o áudio."); return; }
      window.open(url, "_blank", "noopener");
    });
  };

  const retry = (rec: RecordingRow) => {
    startTx(async () => {
      const res = await retranscribeRecording(rec.id);
      if (res.error) { toast.error(res.error); return; }
      toast.success("Transcrição reiniciada.");
      await refresh();
    });
  };

  const remove = async (rec: RecordingRow) => {
    const ok = await confirmDialog({
      title: "Excluir gravação",
      message: "A gravação e a transcrição serão removidas. Esta ação não pode ser desfeita.",
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (!ok) return;
    startTx(async () => {
      const res = await deleteRecording(rec.id);
      if (res.error) { toast.error(res.error); return; }
      await refresh();
    });
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 9, padding: "0.7rem 0.9rem", background: "var(--surface-2)", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap" }}>
        <label className="label" style={{ margin: 0 }}>🎙 Gravação da reunião</label>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          {recording ? (
            <>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.82rem", color: "var(--mh-danger)", fontVariantNumeric: "tabular-nums" }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--mh-danger)", display: "inline-block", animation: "mh-live-core 1.2s ease-in-out infinite" }} />
                {formatDuration(elapsed)}
              </span>
              <button type="button" className="btn btn-primary btn-sm" onClick={stopRecording}>Parar</button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={startRecording} disabled={busy}>● Gravar</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy ? "Enviando…" : "Enviar áudio"}
              </button>
              <input ref={fileRef} type="file" accept="audio/*" onChange={onPickFile} style={{ display: "none" }} />
            </>
          )}
        </div>
      </div>

      {recordings.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          Grave o áudio da reunião ou envie um arquivo. A transcrição é feita automaticamente e pode alimentar a IA.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
          {recordings.map((rec) => (
            <div key={rec.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.5rem 0.7rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: "0.83rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {rec.source === "upload" ? "Arquivo enviado" : "Gravação"}
                    {rec.durationSeconds ? ` · ${formatDuration(rec.durationSeconds)}` : ""}
                    {rec.size ? ` · ${formatBytes(rec.size)}` : ""}
                  </div>
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
                    <div style={{ marginTop: "0.4rem", fontSize: "0.8rem", whiteSpace: "pre-wrap", background: "var(--surface-2)", borderRadius: 8, padding: "0.55rem 0.7rem", maxHeight: 220, overflowY: "auto", lineHeight: 1.5 }}>
                      {rec.transcript}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => play(rec)}>Ouvir</button>
                {rec.status === "concluida" && rec.transcript && onSaveTranscript && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onSaveTranscript(rec.transcript ?? ""); toast.success("Transcrição salva no registro da reunião."); }}>
                    Salvar transcrição
                  </button>
                )}
                {rec.status === "concluida" && rec.transcript && onUseTranscript && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onUseTranscript(rec.transcript ?? ""); toast.success("Transcrição enviada para o rascunho da IA."); }}>
                    Usar como rascunho da IA
                  </button>
                )}
                {(rec.status === "falha" || rec.status === "pendente" || rec.status === "processando") && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => retry(rec)}>Transcrever novamente</button>
                )}
                <button type="button" className="btn btn-ghost btn-sm" style={{ color: "var(--mh-danger)" }} onClick={() => remove(rec)}>Excluir</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
