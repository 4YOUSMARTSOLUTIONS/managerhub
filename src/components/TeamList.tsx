"use client";

import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate, normalizar } from "@/lib/format";
import { USER_TYPE } from "@/lib/constants";
import { roleTone } from "./UsersManager";
import { MovementTimeline } from "./MovementTimeline";

export type TeamMember = {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
  employeeCode: string | null;
  admissionDate: string | null;
  active: boolean;
  role: string;
  departmentName: string | null;
  subdepartmentName: string | null;
  positionName: string | null;
  levelName: string | null;
  hierarchyName: string | null;
  /** chefe DIRETO: com a cadeia inteira à vista, é o que diz o nível de cada um */
  managerName: string | null;
  /** o mesmo chefe, por id: é o que liga pai e filho no organograma */
  managerId: string | null;
  /** ordem da hierarquia (menor = mais alto). Ordena irmãos no organograma */
  hierarchyRank: number | null;
};

export function TeamList({ members }: { members: TeamMember[] }) {
  const [busca, setBusca] = useState("");
  const [somenteAtivos, setSomenteAtivos] = useState(true);
  const [linhaDoTempo, setLinhaDoTempo] = useState<TeamMember | null>(null);

  const visiveis = useMemo(() => {
    const q = normalizar(busca.trim());
    return members.filter((m) => {
      if (somenteAtivos && !m.active) return false;
      if (!q) return true;
      return [m.fullName, m.employeeCode, m.departmentName, m.positionName, m.hierarchyName, m.managerName]
        .some((v) => v && normalizar(v).includes(q));
    });
  }, [members, busca, somenteAtivos]);

  const inativos = members.length - members.filter((m) => m.active).length;

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.9rem 1.1rem", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Equipe · {visiveis.length}</h2>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="input"
            placeholder="Buscar por nome, matrícula, setor ou gestor…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            style={{ width: 300, padding: "0.4rem 0.7rem", fontSize: "0.85rem" }}
          />
          {inativos > 0 && (
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem" }}>
              <input type="checkbox" checked={somenteAtivos} onChange={(e) => setSomenteAtivos(e.target.checked)} />
              Só ativos
            </label>
          )}
        </div>
      </div>

      {visiveis.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Matrícula</th>
              <th>Colaborador</th>
              <th>Setor / Função</th>
              <th>Hierarquia</th>
              <th>Responde a</th>
              <th>Admissão</th>
              <th>Perfil</th>
              <th>Situação</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((m) => (
              <tr key={m.userId} style={{ opacity: m.active ? 1 : 0.6 }}>
                <td className="muted">{m.employeeCode ?? "—"}</td>
                <td>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", fontWeight: 600 }}>
                    <Avatar name={m.fullName} userId={m.userId} />
                    <span>
                      {m.fullName ?? "—"}
                      {m.email && <div className="soft" style={{ fontSize: "0.74rem", fontWeight: 400 }}>{m.email}</div>}
                    </span>
                  </span>
                </td>
                <td className="muted">
                  {m.departmentName ?? "—"}
                  {m.subdepartmentName && <span className="soft"> · {m.subdepartmentName}</span>}
                  {m.positionName && (
                    <div className="soft" style={{ fontSize: "0.75rem" }}>
                      {m.positionName}{m.levelName ? ` · ${m.levelName}` : ""}
                    </div>
                  )}
                </td>
                <td className="muted">{m.hierarchyName ?? "—"}</td>
                <td className="muted">{m.managerName ?? "—"}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{m.admissionDate ? formatDate(m.admissionDate) : "—"}</td>
                <td><Badge tone={roleTone(m.role)}>{m.role === "owner" ? "Proprietário" : USER_TYPE[m.role as keyof typeof USER_TYPE] ?? m.role}</Badge></td>
                <td><Badge tone={m.active ? "green" : "red"}>{m.active ? "Ativo" : "Inativo"}</Badge></td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="Linha do tempo de setor, função, gestor e unidade"
                    onClick={() => setLinhaDoTempo(m)}
                  >
                    Movimentações
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState title="Nada encontrado" description="Nenhum colaborador da sua equipe bate com esse filtro." />
      )}

      {linhaDoTempo && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
          <div className="card" style={{ width: "100%", maxWidth: 900, boxShadow: "var(--mh-shadow-e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", gap: "0.75rem" }}>
              <div>
                <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>Movimentações</h2>
                <p className="soft" style={{ fontSize: "0.82rem", margin: "0.25rem 0 0" }}>{linhaDoTempo.fullName ?? "Colaborador"}</p>
              </div>
              <button type="button" onClick={() => setLinhaDoTempo(null)} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)", flexShrink: 0 }}>×</button>
            </div>
            <div style={{ padding: "1.25rem" }}>
              <MovementTimeline userId={linhaDoTempo.userId} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setLinhaDoTempo(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
