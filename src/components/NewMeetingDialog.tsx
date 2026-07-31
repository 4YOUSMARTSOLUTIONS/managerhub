"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createMeeting, updateMeeting } from "@/lib/actions/meetings";
import { initialActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PeoplePicker, type Person } from "./PeoplePicker";
import { MEETING_STATUS } from "@/lib/constants";
import { blockedReason } from "@/lib/holidays";
import type { CalRoom, CalMeeting } from "./RoomCalendar";

export type Prefill = {
  startInput?: string;
  endInput?: string;
  roomId?: string | null;
};

export type Routine = { id: string; name: string; participantIds: string[] };

export function NewMeetingDialog({
  open,
  onClose,
  initial,
  editing,
  rooms,
  routines,
  people,
  customHolidays = [],
}: {
  open: boolean;
  onClose: () => void;
  initial?: Prefill;
  editing?: CalMeeting | null;
  rooms: CalRoom[];
  routines: Routine[];
  people: Person[];
  customHolidays?: { day: string; name: string }[];
}) {
  const [state, action] = useActionState(editing ? updateMeeting : createMeeting, initialActionState);
  const [seriesId, setSeriesId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [title, setTitle] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [localErr, setLocalErr] = useState("");
  const [holidayWarn, setHolidayWarn] = useState<string | null>(null);
  const [saveWarn, setSaveWarn] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedRef = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (open) {
      setSeriesId(editing?.seriesId ?? "");
      setRoomId(editing ? (editing.room?.id ?? "") : (initial?.roomId ?? ""));
      setTitle(editing?.title ?? "");
      setParticipants(editing?.participantIds ?? []);
      setLocalErr("");
      setHolidayWarn(null);
      setSaveWarn("");
      confirmedRef.current = false;
    }
  }, [open, editing]);

  useEffect(() => {
    if (state.ok && open) {
      router.refresh();
      // se houve aviso (ex.: convite não enviado), mantém aberto mostrando o aviso
      if (state.warning) setSaveWarn(state.warning);
      else onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!open) return null;

  const onRoutine = (id: string) => {
    setSeriesId(id);
    const r = routines.find((x) => x.id === id);
    if (r) { setTitle(r.name); setParticipants(r.participantIds); }
  };

  const isRoutine = !!seriesId;
  const selectedRoom = rooms.find((r) => r.id === roomId) ?? null;
  const startDefault = editing ? editing.startInput : (initial?.startInput ?? "");
  const endDefault = editing ? editing.endInput : (initial?.endInput ?? "");

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (participants.length === 0) { e.preventDefault(); setLocalErr("Selecione ao menos um participante."); return; }
    if (!confirmedRef.current) {
      const v = (e.currentTarget.elements.namedItem("starts_at") as HTMLInputElement | null)?.value;
      const hn = v ? blockedReason(new Date(v), customHolidays) : null;
      if (hn) { e.preventDefault(); setHolidayWarn(hn); return; }
    }
    confirmedRef.current = false;
  };

  return (
    <>
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 520, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{editing ? "Editar reunião" : "Nova reunião"}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>
        <form action={action} onSubmit={onSubmit} ref={formRef}>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <input type="hidden" name="series_id" value={seriesId} />
          <input type="hidden" name="participants" value={JSON.stringify(participants)} />
          <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            {routines.length > 0 && (
              <div>
                <label className="label">Reunião de rotina <span className="soft">(opcional)</span></label>
                <select className="select" value={seriesId} onChange={(e) => onRoutine(e.target.value)}>
                  <option value="">Reunião avulsa</option>
                  {routines.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                {isRoutine && <p className="soft" style={{ fontSize: "0.78rem", margin: "0.3rem 0 0" }}>Título e participantes vêm da rotina — você só define data, horário e sala.</p>}
              </div>
            )}

            {!isRoutine && (
              <>
                <div>
                  <label className="label">Título</label>
                  <input name="title" className="input" required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Reunião semanal de planejamento" />
                </div>
                <div>
                  <label className="label">Descrição</label>
                  <textarea name="description" className="textarea" defaultValue={editing?.description ?? ""} placeholder="Pauta / objetivo" />
                </div>
              </>
            )}
            {isRoutine && <input type="hidden" name="title" value={title} />}

            <div>
              <label className="label">Sala</label>
              <select name="room_id" className="select" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">Sem sala</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {selectedRoom && (
                <div style={{ marginTop: "0.5rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem" }}>
                  {(selectedRoom.capacity || selectedRoom.location) && (
                    <span className="muted" style={{ fontSize: "0.8rem" }}>
                      {selectedRoom.capacity ? `${selectedRoom.capacity} lugares` : ""}
                      {selectedRoom.capacity && selectedRoom.location ? " · " : ""}
                      {selectedRoom.location ?? ""}
                    </span>
                  )}
                  {selectedRoom.resources.length > 0 ? (
                    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "0.3rem" }}>
                      {selectedRoom.resources.map((res) => <span key={res} className="badge badge-gray">{res}</span>)}
                    </span>
                  ) : <span className="soft" style={{ fontSize: "0.8rem" }}>Sem recursos cadastrados.</span>}
                </div>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
              <div>
                <label className="label">Início</label>
                <input name="starts_at" type="datetime-local" className="input" required defaultValue={startDefault} />
              </div>
              <div>
                <label className="label">Fim</label>
                <input name="ends_at" type="datetime-local" className="input" required defaultValue={endDefault} />
              </div>
            </div>

            {editing && (
              <div>
                <label className="label">Status</label>
                <select name="status" className="select" defaultValue={editing.status}>
                  {(Object.entries(MEETING_STATUS) as [string, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="label">Participantes <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <PeoplePicker people={people} selected={participants} onChange={(ids) => { setParticipants(ids); if (ids.length) setLocalErr(""); }} placeholder="Adicionar participante…" />
            </div>

            {(localErr || state.error) && (
              <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{localErr || state.error}</p>
            )}
            {saveWarn && (
              <p style={{ color: "var(--mh-warning)", fontSize: "0.85rem", margin: 0, background: "var(--mh-warning-soft)", border: "1px solid color-mix(in srgb, var(--mh-warning) 32%, transparent)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>⚠️ {saveWarn}</p>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
            {saveWarn ? (
              <button type="button" className="btn btn-primary" onClick={onClose}>Fechar</button>
            ) : (
              <>
                <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
                <SubmitButton>{editing ? "Salvar" : "Agendar"}</SubmitButton>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
    <ConfirmDialog
      open={!!holidayWarn}
      title="Atenção: dia não útil"
      message={<>O dia escolhido é <strong>{holidayWarn}</strong>. Normalmente não há expediente. Deseja agendar mesmo assim?</>}
      confirmLabel="Agendar mesmo assim"
      cancelLabel="Voltar"
      onConfirm={() => { confirmedRef.current = true; setHolidayWarn(null); formRef.current?.requestSubmit(); }}
      onClose={() => setHolidayWarn(null)}
    />
    </>
  );
}
