"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setTicketManagerSectors } from "@/lib/actions/tickets";

type Member = { userId: string; name: string; sectorIds: string[] };
type Sector = { id: string; name: string };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function TicketManagersEditor({ members, sectors }: { members: Member[]; sectors: Sector[] }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Member | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const router = useRouter();

  const sectorName = useMemo(() => new Map(sectors.map((s) => [s.id, s.name])), [sectors]);
  const managerCount = members.filter((m) => m.sectorIds.length > 0).length;

  const q = norm(query);
  const searching = q.length > 0;
  const filtered = useMemo(() => {
    // sem busca: mostra só quem já é gestor. Com busca: procura em todos os colaboradores.
    const list = searching
      ? members.filter((m) => norm(m.name).includes(q))
      : members.filter((m) => m.sectorIds.length > 0);
    return [...list].sort((a, b) => {
      const am = a.sectorIds.length > 0, bm = b.sectorIds.length > 0;
      return am === bm ? a.name.localeCompare(b.name, "pt-BR") : am ? -1 : 1;
    });
  }, [members, q, searching]);

  const openEdit = (m: Member) => { setEditing(m); setPicked(new Set(m.sectorIds)); };
  const toggleSector = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const save = () => {
    if (!editing) return;
    start(async () => {
      const res = await setTicketManagerSectors({ user_id: editing.userId, sector_ids: [...picked] });
      if (res.error) { toast.error(res.error); return; }
      setEditing(null);
      router.refresh();
    });
  };

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div style={{ padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Gestores de chamado · {managerCount}</h2>
        <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.82rem" }}>
          Defina responsáveis pelo tratamento dos chamados de cada setor.
        </p>
      </div>

      {members.length === 0 ? (
        <p className="soft" style={{ margin: 0, padding: "1.1rem", fontSize: "0.85rem" }}>Nenhum usuário ativo.</p>
      ) : sectors.length === 0 ? (
        <p className="soft" style={{ margin: 0, padding: "1.1rem", fontSize: "0.85rem" }}>Cadastre setores de chamado primeiro.</p>
      ) : (
        <>
          <div style={{ padding: "0.8rem 1.1rem 0" }}>
            <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar colaborador para tornar gestor…" />
          </div>
          <div style={{ maxHeight: 420, overflowY: "auto", marginTop: "0.6rem" }}>
            {filtered.length === 0 ? (
              <p className="soft" style={{ margin: 0, padding: "0.4rem 1.1rem 1.1rem", fontSize: "0.85rem" }}>
                {searching ? "Nenhum colaborador encontrado." : "Nenhum gestor definido. Busque um colaborador acima para torná-lo gestor."}
              </p>
            ) : (
              <table className="table">
                <thead>
                  <tr><th>Usuário</th><th>Setores que gerencia</th><th style={{ textAlign: "right" }}>Ações</th></tr>
                </thead>
                <tbody>
                  {filtered.map((m) => (
                    <tr key={m.userId}>
                      <td style={{ fontWeight: 500 }}>{m.name}</td>
                      <td className="muted" style={{ fontSize: "0.8rem" }}>
                        {m.sectorIds.length === 0 ? <span className="soft">— não é gestor</span> : (
                          <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "0.3rem" }}>
                            {m.sectorIds.map((id) => <span key={id} className="badge badge-purple">{sectorName.get(id) ?? "—"}</span>)}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(m)}>Definir setores</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 1rem", zIndex: 80, overflowY: "auto" }}>
          <div className="card" style={{ width: "100%", maxWidth: 460, boxShadow: "var(--mh-shadow-e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>Setores de {editing.name}</h2>
              <button type="button" onClick={() => setEditing(null)} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
            </div>
            <div style={{ padding: "1.1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <p className="muted" style={{ margin: "0 0 0.3rem", fontSize: "0.8rem" }}>Marque os setores dos quais este usuário é gestor. Sem nenhum marcado, ele deixa de ser gestor de chamados.</p>
              {sectors.map((s) => (
                <label key={s.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.88rem", cursor: "pointer", padding: "0.25rem 0" }}>
                  <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggleSector(s.id)} />
                  {s.name}
                </label>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
              <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setEditing(null)}>Cancelar</button>
              <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>{pending ? "Salvando…" : "Salvar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
