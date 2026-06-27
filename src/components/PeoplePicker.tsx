"use client";

import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";

export type Person = { id: string; name: string };

export function PeoplePicker({
  people,
  selected,
  onChange,
  placeholder = "Buscar pessoa…",
  maxVisible = 40,
  single = false,
}: {
  people: Person[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  maxVisible?: number;
  single?: boolean;
}) {
  const [query, setQuery] = useState("");
  const selSet = useMemo(() => new Set(selected), [selected]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return people
      .filter((p) => !selSet.has(p.id) && p.name.toLowerCase().includes(q))
      .slice(0, maxVisible);
  }, [people, query, selSet, maxVisible]);

  const add = (id: string) => { onChange(single ? [id] : [...selected, id]); setQuery(""); };
  const remove = (id: string) => onChange(selected.filter((x) => x !== id));

  return (
    <div>
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.5rem" }}>
          {selected.map((id) => {
            const p = byId.get(id);
            return (
              <span key={id} className="reg-chip" style={{ paddingLeft: "0.35rem" }}>
                <Avatar name={p?.name ?? "?"} />
                <span style={{ fontSize: "0.8rem" }}>{p?.name ?? "—"}</span>
                <button type="button" onClick={() => remove(id)} aria-label="Remover">×</button>
              </span>
            );
          })}
        </div>
      )}
      {!(single && selected.length > 0) && (
        <>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
          />
          {matches.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 9, marginTop: 4, maxHeight: 200, overflowY: "auto" }}>
              {matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => add(p.id)}
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", textAlign: "left", padding: "0.45rem 0.6rem", background: "none", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: "0.85rem" }}
                >
                  <Avatar name={p.name} />
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
