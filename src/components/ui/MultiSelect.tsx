"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export type MultiOption = { value: string; label: string };

/**
 * Filtro de múltipla escolha. Mostra um resumo do que está selecionado e, ao abrir,
 * uma lista com caixas de seleção; com `searchable`, um campo para digitar e reduzir
 * a lista (útil quando são centenas de nomes, como Solicitante e Responsável).
 */
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  searchable = false,
  allLabel = "Todos",
  placeholder = "Digite para buscar…",
}: {
  label: string;
  options: MultiOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
  allLabel?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  // fecha ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const visible = useMemo(() => {
    const t = norm(term.trim());
    return t ? options.filter((o) => norm(o.label).includes(t)) : options;
  }, [options, term]);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const resumo = selected.length === 0
    ? allLabel
    : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label ?? selected[0]
      : `${selected.length} selecionados`;

  return (
    <div ref={boxRef} style={{ position: "relative", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <span className="label" style={{ margin: 0 }}>{label}</span>

      <button
        type="button"
        className="select"
        onClick={() => { setOpen((v) => !v); setTerm(""); }}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.4rem", textAlign: "left", cursor: "pointer" }}
        title={selected.length > 1 ? selected.join(", ") : undefined}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected.length ? "var(--text)" : "var(--text-muted)" }}>
          {resumo}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem", flexShrink: 0 }}>
          {selected.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              aria-label={`Limpar ${label}`}
              onClick={(e) => { e.stopPropagation(); onChange([]); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onChange([]); } }}
              style={{ display: "inline-flex", color: "var(--text-muted)", cursor: "pointer" }}
            >
              <X size={13} />
            </span>
          )}
          <ChevronDown size={14} style={{ color: "var(--text-muted)" }} />
        </span>
      </button>

      {open && (
        <div
          className="card"
          style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, zIndex: 40, boxShadow: "var(--mh-shadow-e3)", maxHeight: 280, display: "flex", flexDirection: "column", overflow: "hidden" }}
        >
          {searchable && (
            <div style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>
              <input
                className="input"
                autoFocus
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder={placeholder}
                style={{ width: "100%", padding: "0.35rem 0.6rem", fontSize: "0.82rem" }}
              />
            </div>
          )}

          <div style={{ overflowY: "auto", padding: "0.25rem" }}>
            {visible.length === 0 ? (
              <div className="soft" style={{ padding: "0.6rem", fontSize: "0.82rem" }}>Nada encontrado.</div>
            ) : (
              visible.map((o) => {
                const on = selected.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggle(o.value)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0.5rem", background: on ? "var(--surface-2)" : "none", border: "none", borderRadius: 6, cursor: "pointer", textAlign: "left", fontSize: "0.85rem", color: "var(--text)" }}
                  >
                    <span style={{ width: 14, height: 14, flexShrink: 0, borderRadius: 4, border: "1px solid var(--border-strong)", display: "inline-flex", alignItems: "center", justifyContent: "center", background: on ? "var(--mh-primary)" : "transparent" }}>
                      {on && <Check size={11} color="#fff" />}
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
