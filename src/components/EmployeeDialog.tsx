"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createEmployee, updateEmployee } from "@/lib/actions/employees";
import { initialActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { GENDER, UNIT_KIND, USER_TYPE, options } from "@/lib/constants";
import { formatCpf } from "@/lib/cpf";

export type Option = { id: string; name: string };
export type SubdeptOption = { id: string; name: string; department_id: string };
export type UnitOption = { id: string; name: string; kind: keyof typeof UNIT_KIND };
export type EmployeeData = {
  userId: string;
  fullName: string | null;
  email: string | null;
  cpf: string | null;
  phone: string | null;
  birthDate: string | null;
  gender: string | null;
  role: string;
  employeeCode: string | null;
  admissionDate: string | null;
  departmentId: string | null;
  subdepartmentId: string | null;
  positionId: string | null;
  positionLevelId: string | null;
  managerId: string | null;
  unitIds: string[];
};

const sectionTitle: React.CSSProperties = {
  fontSize: "0.78rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--text-soft)",
  margin: "0.4rem 0 0",
};
const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" };

function Field({ label, children, req }: { label: string; children: React.ReactNode; req?: boolean }) {
  return (
    <div>
      <label className="label">{label}{req && " *"}</label>
      {children}
    </div>
  );
}

export function EmployeeDialog({
  open,
  onClose,
  employee,
  units,
  departments,
  subdepartments,
  positions,
  levels,
  people,
}: {
  open: boolean;
  onClose: () => void;
  employee?: EmployeeData;
  units: UnitOption[];
  departments: Option[];
  subdepartments: SubdeptOption[];
  positions: Option[];
  levels: Option[];
  people: Option[];
}) {
  const isEdit = !!employee;
  const action = isEdit ? updateEmployee : createEmployee;
  const [state, formAction] = useActionState(action, initialActionState);
  const [deptId, setDeptId] = useState(employee?.departmentId ?? "");
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      onClose();
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!open) return null;

  const subs = subdepartments.filter((s) => s.department_id === deptId);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 1rem", zIndex: 70, overflowY: "auto" }}
    >
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, boxShadow: "var(--shadow)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{isEdit ? "Editar usuário" : "Novo usuário"}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <form action={formAction}>
          {isEdit && <input type="hidden" name="user_id" value={employee!.userId} />}
          <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem", maxHeight: "72vh", overflowY: "auto" }}>

            <p style={sectionTitle}>Dados pessoais</p>
            <Field label="Nome completo" req>
              <input name="full_name" className="input" required defaultValue={employee?.fullName ?? ""} />
            </Field>
            <div style={grid2}>
              <Field label="CPF" req>
                <input name="cpf" className="input" required defaultValue={employee?.cpf ? formatCpf(employee.cpf) : ""} placeholder="000.000.000-00" inputMode="numeric" />
              </Field>
              <Field label="Data de nascimento" req>
                <input name="birth_date" type="date" className="input" required defaultValue={employee?.birthDate ?? ""} />
              </Field>
            </div>
            <div style={grid2}>
              <Field label="Sexo" req>
                <select name="gender" className="select" required defaultValue={employee?.gender ?? ""}>
                  <option value="">Selecione…</option>
                  {options(GENDER).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Telefone">
                <input name="phone" className="input" defaultValue={employee?.phone ?? ""} placeholder="(00) 00000-0000" />
              </Field>
            </div>
            <Field label="E-mail (opcional — também serve para login)">
              <input name="email" type="email" className="input" defaultValue={employee?.email ?? ""} placeholder="opcional" />
            </Field>

            <p style={sectionTitle}>Vínculo na empresa</p>
            <Field label="Unidade(s)" req>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {units.length === 0 && <span className="soft" style={{ fontSize: "0.82rem" }}>Cadastre unidades na aba “Unidades”.</span>}
                {units.map((u) => {
                  const checked = employee?.unitIds.includes(u.id);
                  return (
                    <label key={u.id} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", border: "1px solid var(--border)", borderRadius: 8, padding: "0.3rem 0.6rem", fontSize: "0.85rem", cursor: "pointer" }}>
                      <input type="checkbox" name="unit_ids" value={u.id} defaultChecked={checked} />
                      {u.name} <span className="soft">({UNIT_KIND[u.kind]})</span>
                    </label>
                  );
                })}
              </div>
            </Field>
            <div style={grid2}>
              <Field label="Código do funcionário" req>
                <input name="employee_code" className="input" required defaultValue={employee?.employeeCode ?? ""} />
              </Field>
              <Field label="Tipo de usuário" req>
                {employee?.role === "owner" ? (
                  <>
                    <input type="hidden" name="role" value="owner" />
                    <input className="input" value="Proprietário" disabled />
                  </>
                ) : (
                  <select name="role" className="select" required defaultValue={employee?.role ?? "member"}>
                    {Object.entries(USER_TYPE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                )}
              </Field>
            </div>
            <div style={grid2}>
              <Field label="Setor" req>
                <select name="department_id" className="select" required value={deptId} onChange={(e) => setDeptId(e.target.value)}>
                  <option value="">Selecione…</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="Subsetor" req>
                <select name="subdepartment_id" className="select" required defaultValue={employee?.subdepartmentId ?? ""} key={deptId}>
                  <option value="">Selecione…</option>
                  {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>
            <div style={grid2}>
              <Field label="Função" req>
                <select name="position_id" className="select" required defaultValue={employee?.positionId ?? ""}>
                  <option value="">Selecione…</option>
                  {positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Perfil da função">
                <select name="position_level_id" className="select" defaultValue={employee?.positionLevelId ?? ""}>
                  <option value="">—</option>
                  {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
            </div>
            <div style={grid2}>
              <Field label="Data de admissão" req>
                <input name="admission_date" type="date" className="input" required defaultValue={employee?.admissionDate ?? ""} />
              </Field>
              <Field label="Gestor" req>
                <select name="manager_id" className="select" required defaultValue={employee?.managerId ?? ""}>
                  <option value="">Selecione…</option>
                  {people.filter((p) => p.id !== employee?.userId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
            </div>

            {!isEdit && (
              <>
                <p style={sectionTitle}>Acesso</p>
                <Field label="Senha inicial" req>
                  <PasswordInput autoComplete="new-password" minLength={6} placeholder="Mínimo 6 caracteres" />
                </Field>
              </>
            )}

            {state.error && (
              <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0, background: "#fef2f2", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{state.error}</p>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <SubmitButton>{isEdit ? "Salvar" : "Criar usuário"}</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
