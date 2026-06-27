"use client";

import { useMemo, useState } from "react";

export type SelOpt = { id: string; name: string };

export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "Selecione…",
  disabled = false,
  emptyHint = "Nada encontrado",
  maxVisible = 50,
}: {
  options: SelOpt[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyHint?: string;
  maxVisible?: number;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o.name])), [options]);
  const selectedName = value ? byId.get(value) ?? "—" : "";

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
    return list.slice(0, maxVisible);
  }, [options, query, maxVisible]);

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) { setOpen(false); setQuery(""); }
  };

  return (
    <div onBlur={handleBlur} style={{ position: "relative" }}>
      {value ? (
        <div className="input" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", opacity: disabled ? 0.6 : 1, overflow: "hidden" }}>
          <span title={selectedName} style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedName}</span>
          {!disabled && (
            <button type="button" onClick={() => { onChange(""); setQuery(""); }} aria-label="Limpar" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "1rem", lineHeight: 1, flexShrink: 0 }}>×</button>
          )}
        </div>
      ) : (
        <input
          className="input"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        />
      )}

      {open && !value && !disabled && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, boxShadow: "var(--shadow)", maxHeight: 240, overflowY: "auto" }}>
          {matches.length > 0 ? matches.map((o) => (
            <button
              key={o.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(o.id); setQuery(""); setOpen(false); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "0.45rem 0.7rem", background: "none", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: "0.85rem" }}
            >
              {o.name}
            </button>
          )) : <div className="soft" style={{ padding: "0.5rem 0.7rem", fontSize: "0.82rem" }}>{emptyHint}</div>}
        </div>
      )}
    </div>
  );
}
