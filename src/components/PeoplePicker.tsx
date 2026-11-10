"use client";

import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { normalizar } from "@/lib/format";

/** `code` (opcional) é a matrícula: aparece ao lado do nome e entra na busca. */
export type Person = { id: string; name: string; code?: string | null };

export function PeoplePicker({
  people,
  selected,
  onChange,
  placeholder = "Buscar pessoa…",
  maxVisible = 40,
  single = false,
  autoFocus = false,
}: {
  people: Person[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  maxVisible?: number;
  single?: boolean;
  /** abre já com o cursor na busca (ex.: a blitz da portaria, uma pessoa atrás da outra) */
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const selSet = useMemo(() => new Set(selected), [selected]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  // sem acento e sem caixa ("jose" acha "JOSÉ"), palavra por palavra ("joao
  // araujo" acha "JOÃO PEDRO ARAÚJO"); a matrícula também acha
  const matches = useMemo(() => {
    const termos = normalizar(query.trim()).split(/\s+/).filter(Boolean);
    if (termos.length === 0) return [];
    return people
      .filter((p) => {
        if (selSet.has(p.id)) return false;
        const alvo = `${normalizar(p.name)} ${p.code ? normalizar(p.code) : ""}`;
        return termos.every((t) => alvo.includes(t));
      })
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
                <Avatar name={p?.name ?? "?"} userId={id} />
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
            autoFocus={autoFocus}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {matches.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 9, marginTop: 4, maxHeight: 220, overflowY: "auto" }}>
              {matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="people-picker-opcao"
                  onClick={() => add(p.id)}
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", textAlign: "left", padding: "0.45rem 0.6rem", background: "none", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: "0.85rem" }}
                >
                  <Avatar name={p.name} userId={p.id} />
                  <span style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
                  {p.code && <span className="soft mono" style={{ fontSize: "0.75rem", flexShrink: 0 }}>{p.code}</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
