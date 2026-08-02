"use client";

import { useEffect, useState } from "react";
import { getContractHistory, type ContractHistoryItem } from "@/lib/actions/employees";
import { Badge } from "@/components/ui/Badge";
import { USER_TYPE } from "@/lib/constants";
import { formatCpf } from "@/lib/cpf";
import { formatDate } from "@/lib/format";
import type { EmployeeRow } from "./UsersManager";

const GENDER: Record<string, string> = {
  masculino: "Masculino", feminino: "Feminino", outro: "Outro", nao_informado: "Não informado",
};

const sectionTitle: React.CSSProperties = {
  fontSize: "0.74rem", fontWeight: 700, textTransform: "uppercase",
  letterSpacing: "0.04em", color: "var(--text-soft)", margin: "0 0 0.6rem",
};

/** Um campo da ficha: rótulo em cima, valor embaixo. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="soft" style={{ fontSize: "0.74rem" }}>{label}</div>
      <div style={{ fontSize: "0.88rem", marginTop: 2, wordBreak: "break-word" }}>{children || "—"}</div>
    </div>
  );
}

const grid: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.85rem",
};

/**
 * Ficha do colaborador em modo leitura: os dados do cadastro vigente mais os
 * contratos encerrados. Evita abrir o formulário de edição só para consultar.
 */
export function EmployeeViewDialog({
  employee, onClose,
}: {
  employee: EmployeeRow;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ContractHistoryItem[] | null>(null);

  useEffect(() => {
    let vivo = true;
    getContractHistory(employee.userId).then((r) => { if (vivo) setItems(r); });
    return () => { vivo = false; };
  }, [employee.userId]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 760, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", gap: "0.75rem" }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>{employee.fullName ?? "—"}</h2>
            <div style={{ display: "flex", gap: "0.35rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.4rem" }}>
              <Badge tone={employee.active ? "green" : "red"}>{employee.active ? "Ativo" : "Inativo"}</Badge>
              <Badge tone={employee.role === "owner" ? "purple" : employee.role === "admin" ? "blue" : employee.role === "manager" ? "amber" : "gray"}>
                {employee.role === "owner" ? "Proprietário" : USER_TYPE[employee.role as keyof typeof USER_TYPE] ?? employee.role}
              </Badge>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)", flexShrink: 0 }}>×</button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.4rem" }}>
          <div>
            <p style={sectionTitle}>Dados pessoais</p>
            <div style={grid}>
              <Field label="CPF">{employee.cpf ? formatCpf(employee.cpf) : ""}</Field>
              <Field label="Data de nascimento">{employee.birthDate ? formatDate(employee.birthDate) : ""}</Field>
              <Field label="Sexo">{employee.gender ? GENDER[employee.gender] ?? employee.gender : ""}</Field>
              <Field label="Telefone">{employee.phone}</Field>
              <Field label="E-mail">{employee.email}</Field>
            </div>
          </div>

          <div>
            <p style={sectionTitle}>Contrato atual</p>
            <div style={grid}>
              <Field label="Código">{employee.employeeCode}</Field>
              <Field label="Admissão">{employee.admissionDate ? formatDate(employee.admissionDate) : ""}</Field>
              <Field label="Demissão">{employee.dismissedAt ? formatDate(employee.dismissedAt) : ""}</Field>
              <Field label="Setor">{employee.departmentName}</Field>
              <Field label="Subsetor">{employee.subdepartmentName}</Field>
              <Field label="Função">{employee.positionName}</Field>
              <Field label="Perfil da função">{employee.levelName}</Field>
              <Field label="Gestor">{employee.managerName}</Field>
              <Field label="Unidades">{employee.unitNames.length > 0 ? employee.unitNames.join(", ") : ""}</Field>
            </div>
          </div>

          <div>
            <p style={sectionTitle}>
              Contratos anteriores{items && items.length > 0 ? ` (${items.length})` : ""}
            </p>
            {items === null ? (
              <div className="soft" style={{ fontSize: "0.85rem" }}>Carregando…</div>
            ) : items.length === 0 ? (
              <div className="soft" style={{ fontSize: "0.85rem" }}>Este colaborador tem apenas o contrato atual.</div>
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
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
