"use client";

import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate } from "@/lib/format";
import { USER_TYPE } from "@/lib/constants";
import { roleTone } from "./UsersManager";

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
  /** chefe DIRETO: com a cadeia inteira à vista, é o que diz o nível de cada um */
  managerName: string | null;
};

const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function TeamList({ members }: { members: TeamMember[] }) {
  const [busca, setBusca] = useState("");
  const [somenteAtivos, setSomenteAtivos] = useState(true);

  const visiveis = useMemo(() => {
    const q = normal(busca.trim());
    return members.filter((m) => {
      if (somenteAtivos && !m.active) return false;
      if (!q) return true;
      return [m.fullName, m.employeeCode, m.departmentName, m.positionName, m.managerName]
        .some((v) => v && normal(v).includes(q));
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
              <th>Responde a</th>
              <th>Admissão</th>
              <th>Perfil</th>
              <th>Situação</th>
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
                <td className="muted">{m.managerName ?? "—"}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{m.admissionDate ? formatDate(m.admissionDate) : "—"}</td>
                <td><Badge tone={roleTone(m.role)}>{m.role === "owner" ? "Proprietário" : USER_TYPE[m.role as keyof typeof USER_TYPE] ?? m.role}</Badge></td>
                <td><Badge tone={m.active ? "green" : "red"}>{m.active ? "Ativo" : "Inativo"}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState title="Nada encontrado" description="Nenhum colaborador da sua equipe bate com esse filtro." />
      )}
    </div>
  );
}
