"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createEmployee, updateEmployee } from "@/lib/actions/employees";
import { initialActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { GENDER, ROLE, UNIT_KIND, USER_TYPE, options } from "@/lib/constants";
import { formatCpf } from "@/lib/cpf";

export type Option = { id: string; name: string; active?: boolean };
export type SubdeptOption = { id: string; name: string; department_id: string; active?: boolean };
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
  hierarchyLevelId: string | null;
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
  hierarchies,
  people,
  canSetOwner = false,
}: {
  open: boolean;
  onClose: () => void;
  employee?: EmployeeData;
  units: UnitOption[];
  departments: Option[];
  subdepartments: SubdeptOption[];
  positions: Option[];
  levels: Option[];
  /** níveis de hierarquia, JÁ na ordem da empresa (não alfabética) */
  hierarchies: Option[];
  people: Option[];
  /** super admin: pode definir/alterar o papel Proprietário (owner) */
  canSetOwner?: boolean;
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

  // ao (re)abrir para outro colaborador, sincroniza o setor selecionado (campo controlado)
  useEffect(() => {
    if (open) setDeptId(employee?.departmentId ?? "");
  }, [open, employee]);

  if (!open) return null;

  // mostra só ativos, mas preserva o que já está atribuído ao colaborador (ao editar)
  const act = <T extends { active?: boolean; id: string }>(list: T[], sel: string | null | undefined) =>
    list.filter((o) => o.active !== false || o.id === sel);
  const deptList = act(departments, employee?.departmentId);
  const positionList = act(positions, employee?.positionId);
  const levelList = act(levels, employee?.positionLevelId);
  const hierarchyList = act(hierarchies, employee?.hierarchyLevelId);
  const subs = act(subdepartments.filter((s) => s.department_id === deptId), employee?.subdepartmentId);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 1rem", zIndex: 70, overflowY: "auto" }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 720, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{isEdit ? "Editar colaborador" : "Novo colaborador"}</h2>
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
                {employee?.role === "owner" && !canSetOwner ? (
                  <>
                    <input type="hidden" name="role" value="owner" />
                    <input className="input" value={ROLE.owner} disabled />
                  </>
                ) : (
                  <select name="role" className="select" required defaultValue={employee?.role ?? "member"}>
                    {canSetOwner && <option value="owner">{ROLE.owner}</option>}
                    {Object.entries(USER_TYPE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                )}
              </Field>
            </div>
            <div style={grid2}>
              <Field label="Setor" req>
                <select name="department_id" className="select" required value={deptId} onChange={(e) => setDeptId(e.target.value)}>
                  <option value="">Selecione…</option>
                  {deptList.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="Subsetor">
                <select name="subdepartment_id" className="select" defaultValue={employee?.subdepartmentId ?? ""} key={deptId}>
                  <option value="">— Nenhum —</option>
                  {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>
            <div style={grid2}>
              <Field label="Função" req>
                <select name="position_id" className="select" required defaultValue={employee?.positionId ?? ""}>
                  <option value="">Selecione…</option>
                  {positionList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Perfil da função">
                <select name="position_level_id" className="select" defaultValue={employee?.positionLevelId ?? ""}>
                  <option value="">—</option>
                  {levelList.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
            </div>
            <div style={grid2}>
              {/* Hierarquia é o nível na ESTRUTURA da empresa (Diretoria, Gerência).
                  Não confundir com "Perfil da função" acima, que é a senioridade
                  dentro do cargo (Júnior, Pleno), nem com "Tipo de usuário", que é
                  permissão. A lista vem ordenada do topo para a base. */}
              <Field label="Hierarquia">
                <select name="hierarchy_level_id" className="select" defaultValue={employee?.hierarchyLevelId ?? ""}>
                  <option value="">—</option>
                  {hierarchyList.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
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
                  <PasswordInput autoComplete="new-password" minLength={8} placeholder="Mínimo 8 caracteres" />
                </Field>
              </>
            )}

            {state.error && (
              <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{state.error}</p>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <SubmitButton>{isEdit ? "Salvar" : "Criar colaborador"}</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
