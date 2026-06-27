"use client";

import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormModal } from "@/components/ui/FormModal";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { setUserPassword, removeUser, setMemberActive } from "@/lib/actions/users";
import { USER_TYPE } from "@/lib/constants";
import { formatCpf, onlyDigits } from "@/lib/cpf";
import { EmployeeDialog, type EmployeeData, type Option, type SubdeptOption, type UnitOption } from "./EmployeeDialog";
import { ImportEmployeesDialog } from "./ImportEmployeesDialog";

export type EmployeeRow = EmployeeData & {
  departmentName: string | null;
  positionName: string | null;
  levelName: string | null;
  managerName: string | null;
  unitNames: string[];
  active: boolean;
};

function roleLabel(role: string): string {
  if (role === "owner") return "Proprietário";
  return USER_TYPE[role as keyof typeof USER_TYPE] ?? role;
}

const ICON = {
  edit: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z|m15 5 4 4",
  power: "M12 2v10|M18.36 6.64a9 9 0 1 1-12.73 0",
  lock: "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z|M7 11V7a5 5 0 0 1 10 0v4",
  trash: "M3 6h18|M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6|M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2|M10 11v6|M14 11v6",
};

function Ico({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p.trim()} />)}
    </svg>
  );
}

const MAX_VISIBLE = 100;

export function UsersManager({
  employees,
  units,
  departments,
  subdepartments,
  positions,
  levels,
  people,
  currentUserId,
}: {
  employees: EmployeeRow[];
  units: UnitOption[];
  departments: Option[];
  subdepartments: SubdeptOption[];
  positions: Option[];
  levels: Option[];
  people: Option[];
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeRow | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [query, setQuery] = useState("");

  const openCreate = () => { setEditing(undefined); setOpen(true); };
  const openEdit = (e: EmployeeRow) => { setEditing(e); setOpen(true); };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    const qd = onlyDigits(q);
    return employees.filter((e) =>
      (e.fullName ?? "").toLowerCase().includes(q) ||
      (e.employeeCode ?? "").toLowerCase().includes(q) ||
      (qd.length >= 3 && (e.cpf ?? "").includes(qd)),
    );
  }, [employees, query]);

  const visible = filtered.slice(0, MAX_VISIBLE);

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.9rem 1.1rem", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Usuários · {employees.length}</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="input"
            placeholder="Buscar por nome, CPF ou matrícula…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 280, padding: "0.4rem 0.7rem", fontSize: "0.85rem" }}
          />
          <button className="btn btn-ghost btn-sm" onClick={() => setImportOpen(true)}>↑ Importar em lote</button>
          <button className="btn btn-primary btn-sm" onClick={openCreate}>+ Novo usuário</button>
        </div>
      </div>

      {visible.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Matrícula</th>
              <th>CPF</th>
              <th>Usuário</th>
              <th>Setor / Função</th>
              <th>Tipo</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => {
              const isSelf = e.userId === currentUserId;
              return (
                <tr key={e.userId} style={{ opacity: e.active ? 1 : 0.6 }}>
                  <td className="muted">{e.employeeCode ?? "—"}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{e.cpf ? formatCpf(e.cpf) : "—"}</td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", fontWeight: 600 }}>
                      <Avatar name={e.fullName} />
                      {e.fullName ?? "—"}
                      {isSelf && <span className="soft" style={{ fontSize: "0.72rem" }}>(você)</span>}
                    </span>
                  </td>
                  <td className="muted">
                    {e.departmentName ?? "—"}
                    {e.positionName && <div className="soft" style={{ fontSize: "0.75rem" }}>{e.positionName}{e.levelName ? ` · ${e.levelName}` : ""}</div>}
                  </td>
                  <td><Badge tone={e.role === "owner" ? "purple" : e.role === "admin" ? "blue" : e.role === "manager" ? "amber" : "gray"}>{roleLabel(e.role)}</Badge></td>
                  <td><Badge tone={e.active ? "green" : "red"}>{e.active ? "Ativo" : "Inativo"}</Badge></td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: "0.3rem", justifyContent: "flex-end" }}>
                      <button className="icon-btn" title="Editar" onClick={() => openEdit(e)}><Ico d={ICON.edit} /></button>
                      {!isSelf && e.role !== "owner" && (
                        <form action={setMemberActive} style={{ display: "inline-flex" }}>
                          <input type="hidden" name="user_id" value={e.userId} />
                          <input type="hidden" name="active" value={String(!e.active)} />
                          <button className="icon-btn" type="submit" title={e.active ? "Inativar" : "Ativar"}><Ico d={ICON.power} /></button>
                        </form>
                      )}
                      <FormModal triggerLabel={<Ico d={ICON.lock} />} triggerClassName="icon-btn" title={`Redefinir senha · ${e.fullName ?? ""}`} action={setUserPassword} submitLabel="Salvar senha">
                        <input type="hidden" name="user_id" value={e.userId} />
                        <div>
                          <label className="label">Nova senha</label>
                          <PasswordInput autoComplete="new-password" minLength={6} placeholder="Mínimo 6 caracteres" />
                        </div>
                      </FormModal>
                      {!isSelf && e.role !== "owner" && (
                        <form action={removeUser} style={{ display: "inline-flex" }}>
                          <input type="hidden" name="user_id" value={e.userId} />
                          <button className="icon-btn icon-btn-danger" type="submit" title="Remover"><Ico d={ICON.trash} /></button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <EmptyState title={query ? "Nenhum usuário encontrado" : "Nenhum usuário"} description={query ? "Tente outro nome, CPF ou matrícula." : undefined} />
      )}

      {filtered.length > MAX_VISIBLE && (
        <div className="soft" style={{ padding: "0.75rem 1.1rem", fontSize: "0.82rem", borderTop: "1px solid var(--border)" }}>
          Mostrando {MAX_VISIBLE} de {filtered.length}. Refine a busca para encontrar usuários específicos.
        </div>
      )}

      <EmployeeDialog
        open={open}
        onClose={() => setOpen(false)}
        employee={editing}
        units={units}
        departments={departments}
        subdepartments={subdepartments}
        positions={positions}
        levels={levels}
        people={people}
      />

      <ImportEmployeesDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
