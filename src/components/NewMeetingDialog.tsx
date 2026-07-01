"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createMeeting, updateMeeting } from "@/lib/actions/meetings";
import { initialActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PeoplePicker, type Person } from "./PeoplePicker";
import { MEETING_STATUS } from "@/lib/constants";
import { holidayName } from "@/lib/holidays";
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
  const [title, setTitle] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [localErr, setLocalErr] = useState("");
  const [holidayWarn, setHolidayWarn] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedRef = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (open) {
      setSeriesId(editing?.seriesId ?? "");
      setTitle(editing?.title ?? "");
      setParticipants(editing?.participantIds ?? []);
      setLocalErr("");
      setHolidayWarn(null);
      confirmedRef.current = false;
    }
  }, [open, editing]);

  useEffect(() => {
    if (state.ok && open) { onClose(); router.refresh(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!open) return null;

  const onRoutine = (id: string) => {
    setSeriesId(id);
    const r = routines.find((x) => x.id === id);
    if (r) { setTitle(r.name); setParticipants(r.participantIds); }
  };

  const isRoutine = !!seriesId;
  const roomDefault = editing ? (editing.room?.id ?? "") : (initial?.roomId ?? "");
  const startDefault = editing ? editing.startInput : (initial?.startInput ?? "");
  const endDefault = editing ? editing.endInput : (initial?.endInput ?? "");

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (participants.length === 0) { e.preventDefault(); setLocalErr("Selecione ao menos um participante."); return; }
    if (!confirmedRef.current) {
      const v = (e.currentTarget.elements.namedItem("starts_at") as HTMLInputElement | null)?.value;
      const hn = v ? holidayName(new Date(v), customHolidays) : null;
      if (hn) { e.preventDefault(); setHolidayWarn(hn); return; }
    }
    confirmedRef.current = false;
  };

  return (
    <>
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 520, boxShadow: "var(--shadow)" }}>
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
              <select name="room_id" className="select" defaultValue={roomDefault}>
                <option value="">Sem sala</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
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
              <label className="label">Participantes <span style={{ color: "#dc2626" }}>*</span></label>
              <PeoplePicker people={people} selected={participants} onChange={(ids) => { setParticipants(ids); if (ids.length) setLocalErr(""); }} placeholder="Adicionar participante…" />
            </div>

            {(localErr || state.error) && (
              <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0, background: "#fef2f2", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{localErr || state.error}</p>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <SubmitButton>{editing ? "Salvar" : "Agendar"}</SubmitButton>
          </div>
        </form>
      </div>
    </div>
    <ConfirmDialog
      open={!!holidayWarn}
      title="Atenção: feriado"
      message={<>O dia escolhido é <strong>{holidayWarn}</strong> (feriado). Normalmente não há expediente. Deseja agendar mesmo assim?</>}
      confirmLabel="Agendar mesmo assim"
      cancelLabel="Voltar"
      onConfirm={() => { confirmedRef.current = true; setHolidayWarn(null); formRef.current?.requestSubmit(); }}
      onClose={() => setHolidayWarn(null)}
    />
    </>
  );
}
