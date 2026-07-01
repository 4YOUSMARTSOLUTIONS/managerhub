"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rateTicket } from "@/lib/actions/tickets";
import { npsColor, npsFace } from "@/lib/nps";

export function NpsRating({ ticketId, current, currentComment }: { ticketId: string; current: number | null; currentComment: string | null }) {
  const [score, setScore] = useState<number | null>(current);
  const [comment, setComment] = useState(currentComment ?? "");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = () => {
    setError("");
    if (score == null) { setError("Escolha uma nota de 0 a 10."); return; }
    start(async () => {
      const res = await rateTicket({ ticket_id: ticketId, score, comment });
      if (res.error) { setError(res.error); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      router.refresh();
    });
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 9, padding: "0.8rem 0.9rem", background: "var(--surface-2)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.6rem" }}>
        <label className="label" style={{ margin: 0 }}>Avalie o atendimento {score != null && <span style={{ fontSize: "1.1rem" }}>{npsFace(score)}</span>}</label>
        <span style={{ fontSize: "0.76rem", color: "#16a34a", opacity: saved ? 1 : 0, transition: "opacity 0.2s" }}>✓ Avaliação enviada</span>
      </div>
      <p className="soft" style={{ fontSize: "0.76rem", margin: "0.2rem 0 0.5rem" }}>
        De 0 a 10, o quanto você recomendaria o atendimento?
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
        {Array.from({ length: 11 }, (_, n) => {
          const active = score === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => setScore(n)}
              aria-label={`Nota ${n}`}
              style={{
                width: 34, height: 34, borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: "0.85rem",
                border: `1px solid ${active ? npsColor(n) : "var(--border)"}`,
                background: active ? npsColor(n) : "var(--surface)",
                color: active ? "#fff" : "var(--text)",
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
      <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comentário (opcional)" style={{ marginTop: "0.6rem" }} />
      {error && <p style={{ color: "#dc2626", fontSize: "0.8rem", margin: "0.4rem 0 0" }}>{error}</p>}
      <div style={{ marginTop: "0.6rem" }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={pending || score == null} onClick={submit}>
          {pending ? "Enviando…" : current == null ? "Enviar avaliação" : "Atualizar avaliação"}
        </button>
      </div>
    </div>
  );
}
