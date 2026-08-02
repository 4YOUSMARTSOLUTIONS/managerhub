"use client";

import { useEffect, useState } from "react";
import { getContractHistory, type ContractHistoryItem } from "@/lib/actions/employees";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate } from "@/lib/format";

/**
 * Contratos encerrados do colaborador (vínculos anteriores, com outro código).
 * O vínculo vigente continua sendo o da linha na lista; aqui fica só o histórico.
 */
export function ContractHistoryDialog({
  userId, name, onClose,
}: {
  userId: string;
  name: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ContractHistoryItem[] | null>(null);

  useEffect(() => {
    let vivo = true;
    getContractHistory(userId).then((r) => { if (vivo) setItems(r); });
    return () => { vivo = false; };
  }, [userId]);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 1rem", zIndex: 70, overflowY: "auto" }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 720, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>Contratos anteriores</h2>
            <div className="soft" style={{ fontSize: "0.82rem", marginTop: 2 }}>{name}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: items && items.length > 0 ? 0 : "1.25rem" }}>
          {items === null ? (
            <div className="soft" style={{ fontSize: "0.88rem" }}>Carregando…</div>
          ) : items.length === 0 ? (
            <EmptyState title="Sem contratos anteriores" description="Este colaborador tem apenas o vínculo atual." />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Admissão</th>
                    <th>Demissão</th>
                    <th>Setor</th>
                    <th>Subsetor</th>
                    <th>Função</th>
                    <th>Perfil</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c, i) => (
                    <tr key={i}>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{c.employee_code ?? "—"}</td>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{c.admission_date ? formatDate(c.admission_date) : "—"}</td>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{c.dismissed_at ? formatDate(c.dismissed_at) : "—"}</td>
                      <td className="muted">{c.departamento ?? "—"}</td>
                      <td className="muted">{c.subsetor ?? "—"}</td>
                      <td className="muted">{c.funcao ?? "—"}</td>
                      <td className="muted">{c.perfil ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
