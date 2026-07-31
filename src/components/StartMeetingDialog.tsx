"use client";

import { useEffect, useState } from "react";
import type { Room } from "./SeriesDialog";

export function StartMeetingDialog({
  open,
  seriesName,
  defaultRoomId,
  rooms,
  pending,
  onConfirm,
  onClose,
  anticipate = false,
  scheduledLabel,
  defaultNextDate = "",
  defaultNextTime = "",
}: {
  open: boolean;
  seriesName: string;
  defaultRoomId: string | null;
  rooms: Room[];
  pending: boolean;
  onConfirm: (roomId: string, link: string, nextDate?: string, nextTime?: string) => void;
  onClose: () => void;
  anticipate?: boolean;
  scheduledLabel?: string | null;
  defaultNextDate?: string;
  defaultNextTime?: string;
}) {
  const [roomId, setRoomId] = useState("");
  const [link, setLink] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [nextTime, setNextTime] = useState("");

  useEffect(() => {
    if (open) {
      setRoomId(defaultRoomId ?? "");
      setLink("");
      setNextDate(defaultNextDate ?? "");
      setNextTime((defaultNextTime ?? "").slice(0, 5));
    }
  }, [open, defaultRoomId, defaultNextDate, defaultNextTime]);

  if (!open) return null;

  const canConfirm = !pending && (!anticipate || !!nextDate);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "10vh 1rem", zIndex: 70, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 440, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ padding: "1.1rem 1.25rem 0.5rem" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{anticipate ? "Antecipar reunião" : "Iniciar reunião"}</h2>
          {anticipate ? (
            <p className="muted" style={{ fontSize: "0.9rem", marginTop: "0.4rem", marginBottom: 0 }}>
              {scheduledLabel ? <>Esta reunião está agendada para <strong>{scheduledLabel}</strong>. </> : null}
              Deseja antecipar <strong>{seriesName}</strong> para esta data e horário? Informe abaixo quando será a próxima reunião.
            </p>
          ) : (
            <p className="muted" style={{ fontSize: "0.9rem", marginTop: "0.4rem", marginBottom: 0 }}>
              Iniciar <strong>{seriesName}</strong> agora? O cronômetro começará a contar.
            </p>
          )}
        </div>

        <div style={{ padding: "0.75rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          {anticipate && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: "0.8rem", background: "var(--surface-2)", padding: "0.75rem", borderRadius: 9 }}>
              <div>
                <label className="label">Próxima reunião <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                <input type="date" className="input" value={nextDate} onChange={(e) => setNextDate(e.target.value)} disabled={pending} />
              </div>
              <div>
                <label className="label">Horário</label>
                <input type="time" className="input" value={nextTime} onChange={(e) => setNextTime(e.target.value)} disabled={pending} />
              </div>
            </div>
          )}

          <div>
            <label className="label">Sala utilizada</label>
            <select className="select" value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={pending}>
              <option value="">Nenhuma (online / sem sala)</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <p className="soft" style={{ fontSize: "0.78rem", marginTop: "0.3rem" }}>
              Se escolher uma sala, ela será reservada no calendário durante a reunião, mesmo sem reserva prévia.
            </p>
          </div>

          <div>
            <label className="label">Link da reunião (opcional)</label>
            <input type="url" className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" disabled={pending} />
            <p className="soft" style={{ fontSize: "0.78rem", marginTop: "0.3rem" }}>
              Para reuniões online, informe o link (Teams, Meet, Zoom…).
            </p>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "0.85rem 1.25rem 1.15rem" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => onConfirm(roomId, link, anticipate ? nextDate : undefined, anticipate ? nextTime : undefined)} disabled={!canConfirm}>
            {pending ? (anticipate ? "Antecipando…" : "Iniciando…") : (anticipate ? "Antecipar e iniciar" : "Iniciar")}
          </button>
        </div>
      </div>
    </div>
  );
}
