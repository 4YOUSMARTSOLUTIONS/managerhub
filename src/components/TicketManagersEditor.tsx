"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTicketManager } from "@/lib/actions/tickets";

type Member = { userId: string; name: string; isManager: boolean };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function TicketManagersEditor({ members }: { members: Member[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [, start] = useTransition();
  const router = useRouter();

  const managerCount = members.filter((m) => m.isManager).length;
  const filtered = useMemo(() => {
    const q = norm(query);
    const list = q ? members.filter((m) => norm(m.name).includes(q)) : members;
    // gestores marcados primeiro, depois alfabético
    return [...list].sort((a, b) => (a.isManager === b.isManager ? 0 : a.isManager ? -1 : 1));
  }, [members, query]);

  const toggle = (userId: string, value: boolean) => {
    setBusyId(userId);
    start(async () => {
      await setTicketManager({ user_id: userId, value });
      setBusyId(null);
      router.refresh();
    });
  };

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div style={{ padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Gestores de chamado · {managerCount}</h2>
        <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.82rem" }}>
          Apenas os gestores marcados (além de owner/admin) podem tratar chamados — alterar status, prioridade, categoria e responsável.
        </p>
      </div>
      {members.length === 0 ? (
        <p className="soft" style={{ margin: 0, padding: "1.1rem", fontSize: "0.85rem" }}>Nenhum usuário ativo.</p>
      ) : (
        <>
          <div style={{ padding: "0.8rem 1.1rem 0" }}>
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar colaborador…"
            />
          </div>
          <div style={{ maxHeight: 420, overflowY: "auto", marginTop: "0.6rem" }}>
            {filtered.length === 0 ? (
              <p className="soft" style={{ margin: 0, padding: "0.4rem 1.1rem 1.1rem", fontSize: "0.85rem" }}>Nenhum colaborador encontrado.</p>
            ) : (
            <table className="table">
              <thead>
                <tr><th>Usuário</th><th style={{ textAlign: "right" }}>Gestor de chamados</th></tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                <tr key={m.userId}>
                  <td style={{ fontWeight: 500 }}>{m.name}</td>
                  <td style={{ textAlign: "right" }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", cursor: "pointer", fontSize: "0.85rem" }}>
                      <input
                        type="checkbox"
                        checked={m.isManager}
                        disabled={busyId === m.userId}
                        onChange={(e) => toggle(m.userId, e.target.checked)}
                      />
                      {m.isManager ? "Sim" : "Não"}
                    </label>
                  </td>
                </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
