"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { formatDate } from "@/lib/format";

/**
 * Período, num campo só.
 *
 * As duas datas entram e saem juntas: "de 01/07 até 31/07" é uma informação, e
 * separá-las deixava remover uma ponta e continuar filtrando pela outra sem que
 * a tela dissesse nada. Preencher só uma ponta continua valendo, e o resumo diz
 * qual das duas é ("a partir de", "até").
 */
export function PeriodoPilula({ label = "Data de criação", from, to, onChange }: {
  label?: string;
  from: string;
  to: string;
  onChange: (patch: { from?: string; to?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const fora = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [open]);

  const resumo = from && to ? `${formatDate(from)} a ${formatDate(to)}`
    : from ? `a partir de ${formatDate(from)}`
    : to ? `até ${formatDate(to)}`
    : "Qualquer data";

  return (
    <div ref={box} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", maxWidth: 280, padding: "0.24rem 0.5rem", fontSize: "0.76rem", lineHeight: 1.5, borderRadius: "6px 0 0 6px", border: "1px solid var(--mh-border)", background: "var(--mh-surface-1)", color: "var(--text)", cursor: "pointer", fontFamily: "inherit" }}
      >
        <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{label}:</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: from || to ? "var(--text)" : "var(--text-muted)" }}>{resumo}</span>
        <ChevronDown size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      </button>
      {open && (
        <div
          className="card"
          style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 40, padding: "0.6rem", minWidth: 210, boxShadow: "var(--mh-shadow-e3)", display: "flex", flexDirection: "column", gap: "0.5rem" }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span className="label" style={{ margin: 0 }}>De</span>
            <input type="date" className="input" value={from} onChange={(e) => onChange({ from: e.target.value })} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span className="label" style={{ margin: 0 }}>Até</span>
            <input type="date" className="input" value={to} onChange={(e) => onChange({ to: e.target.value })} />
          </label>
          {from && to && to < from && (
            <span style={{ color: "var(--mh-danger)", fontSize: "0.72rem" }}>A data final é anterior à inicial.</span>
          )}
        </div>
      )}
    </div>
  );
}

/** casca da pílula: o × limpa o valor E tira o filtro da tela, nessa ordem */
export function Pilula({ onRemove, children }: { onRemove: () => void; children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remover filtro"
        title="Remover filtro"
        style={{ display: "inline-flex", alignItems: "center", padding: "0.24rem 0.3rem", border: "1px solid var(--mh-border)", borderLeft: "none", borderRadius: "0 6px 6px 0", background: "var(--mh-surface-1)", color: "var(--text-muted)", cursor: "pointer", lineHeight: 1 }}
      >
        <X size={12} />
      </button>
    </span>
  );
}

/** o menu do "+ Filtro": só oferece o que ainda não está na tela */
export function AdicionarFiltro<K extends string>({ disponiveis, onAdd }: {
  disponiveis: { key: K; label: string }[];
  onAdd: (k: K) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const fora = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (disponiveis.length === 0) return null;

  return (
    <div ref={box} style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" className="btn btn-xs btn-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Plus size={12} /> Filtro
      </button>
      {open && (
        <div
          className="card"
          style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 40, padding: "0.25rem", minWidth: 190, maxHeight: 300, overflowY: "auto", boxShadow: "var(--mh-shadow-e3)" }}
        >
          {disponiveis.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => { onAdd(c.key); setOpen(false); }}
              style={{ width: "100%", display: "block", padding: "0.32rem 0.45rem", background: "none", border: "none", borderRadius: 6, cursor: "pointer", textAlign: "left", fontSize: "0.8rem", color: "var(--text)" }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
