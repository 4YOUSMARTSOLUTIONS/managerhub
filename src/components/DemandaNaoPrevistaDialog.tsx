"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { registrarDemandaNaoPrevista } from "@/lib/actions/agenda";

/** Hora atual arredondada para baixo em 5 minutos: o ponto de partida mais provável. */
function horaAgora(): string {
  const d = new Date();
  const m = d.getMinutes() - (d.getMinutes() % 5);
  return `${String(d.getHours()).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Atalho do diário de bordo para registrar o que surgiu fora da rotina.
 *
 * Já dava para fazer isso criando uma tarefa de data única na agenda, mas eram
 * seis passos e a agenda da rotina é do gestor. Aqui são quatro campos, e a
 * demanda entra no diário de quem registrou.
 *
 * Só é montado aberto, então os campos nascem limpos a cada abertura, com a
 * data do dia em tela e a hora de agora. Não fecha por clique fora: é
 * formulário.
 */
export function DemandaNaoPrevistaDialog({
  dataInicial, onClose, onSaved,
}: {
  dataInicial: string;
  onClose: () => void;
  onSaved: (date: string) => void;
}) {
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(dataInicial);
  const [time, setTime] = useState(horaAgora);
  const [duration, setDuration] = useState(30);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) { setError("Descreva a demanda que surgiu."); return; }
    if (!date) { setError("Informe a data da demanda."); return; }
    if (!time) { setError("Informe o horário em que a demanda começou."); return; }
    start(async () => {
      const r = await registrarDemandaNaoPrevista({ title, description, date, time, duration_minutes: duration });
      if (r.error) { setError(r.error); return; }
      onSaved(date);
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3,6,14,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <form onSubmit={submit} className="card" style={{ width: "100%", maxWidth: 480, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", padding: "1rem 1.25rem", borderBottom: "1px solid var(--mh-border)" }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Demanda não prevista</h2>
            <div className="soft" style={{ fontSize: "0.78rem", marginTop: 2 }}>
              Entra no seu diário na data escolhida. Conta na carga do dia, mas não na aderência da rotina.
            </div>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Fechar"><X size={16} /></button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          <div>
            <label className="label" htmlFor="dnp-titulo">O que surgiu?</label>
            <input id="dnp-titulo" className="input" autoFocus maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Atender auditoria do fornecedor" />
          </div>
          {/* três por linha no computador, dois no celular (a duração desce) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.6rem" }}>
            <div>
              <label className="label" htmlFor="dnp-data">Data</label>
              <input id="dnp-data" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="dnp-hora">Início</label>
              <input id="dnp-hora" type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="dnp-duracao">Duração (min)</label>
              <input id="dnp-duracao" type="number" min={5} max={720} step={5} className="input" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="dnp-descricao">Descrição <span className="soft">(opcional)</span></label>
            <textarea id="dnp-descricao" className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Quem pediu, o que envolveu, o que ficou pendente." />
          </div>
          {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{error}</p>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--mh-border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Registrando…" : "Registrar demanda"}</button>
        </div>
      </form>
    </div>
  );
}
