"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createMeeting } from "@/lib/actions/meetings";
import { initialActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { CalRoom } from "./RoomCalendar";

export type Prefill = {
  startInput?: string;
  endInput?: string;
  roomId?: string | null;
};

export function NewMeetingDialog({
  open,
  onClose,
  initial,
  rooms,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Prefill;
  rooms: CalRoom[];
}) {
  const [state, action] = useActionState(createMeeting, initialActionState);
  const router = useRouter();

  useEffect(() => {
    if (state.ok && open) {
      onClose();
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}
    >
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 520, boxShadow: "var(--shadow)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Nova reunião</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>
        <form action={action}>
          <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label className="label">Título</label>
              <input name="title" className="input" required autoFocus placeholder="Reunião semanal de planejamento" />
            </div>
            <div>
              <label className="label">Descrição</label>
              <textarea name="description" className="textarea" placeholder="Pauta / objetivo" />
            </div>
            <div>
              <label className="label">Sala</label>
              <select name="room_id" className="select" defaultValue={initial?.roomId ?? ""}>
                <option value="">Sem sala</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
              <div>
                <label className="label">Início</label>
                <input name="starts_at" type="datetime-local" className="input" required defaultValue={initial?.startInput ?? ""} />
              </div>
              <div>
                <label className="label">Fim</label>
                <input name="ends_at" type="datetime-local" className="input" required defaultValue={initial?.endInput ?? ""} />
              </div>
            </div>
            {state.error && (
              <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0, background: "#fef2f2", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{state.error}</p>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <SubmitButton>Agendar</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
