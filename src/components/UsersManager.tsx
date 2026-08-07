"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ui/confirm";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormModal } from "@/components/ui/FormModal";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { setUserPassword, removeUser, setMemberActive } from "@/lib/actions/users";
import { USER_TYPE, type Tone } from "@/lib/constants";
import { formatCpf, onlyDigits } from "@/lib/cpf";
import { EmployeeDialog, type EmployeeData, type Option, type SubdeptOption, type UnitOption } from "./EmployeeDialog";
import { ImportEmployeesDialog } from "./ImportEmployeesDialog";
import { EmployeeViewDialog } from "./EmployeeViewDialog";
import { IconImport } from "@/components/ui/ImpExpIcons";
import { ExportButton } from "@/components/ui/ExportButton";

export type EmployeeRow = EmployeeData & {
  departmentName: string | null;
  subdepartmentName: string | null;
  positionName: string | null;
  levelName: string | null;
  hierarchyName: string | null;
  managerName: string | null;
  /** matrícula do gestor: é ela que a reimportação usa como chave */
  managerCode: string | null;
  unitNames: string[];
  active: boolean;
  dismissedAt: string | null;
};

function roleLabel(role: string): string {
  if (role === "owner") return "Proprietário";
  return USER_TYPE[role as keyof typeof USER_TYPE] ?? role;
}

/** Cor do selo por perfil. Exportada porque a ficha do colaborador usa a mesma. */
export function roleTone(role: string): Tone {
  if (role === "owner") return "purple";
  if (role === "admin") return "blue";
  if (role === "manager") return "amber";
  // Gestor puxa para o verde: é alçada de equipe, não de empresa, e o contraste
  // com o âmbar do Gerencial evita a troca de um pelo outro na leitura rápida.
  if (role === "team_lead") return "green";
  return "gray";
}

const ICON = {
  edit: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z|m15 5 4 4",
  power: "M12 2v10|M18.36 6.64a9 9 0 1 1-12.73 0",
  lock: "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z|M7 11V7a5 5 0 0 1 10 0v4",
  trash: "M3 6h18|M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6|M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2|M10 11v6|M14 11v6",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
};

function Ico({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p.trim()} />)}
    </svg>
  );
}

const PAGE_SIZE = 50;

export function UsersManager({
  employees,
  units,
  departments,
  subdepartments,
  positions,
  levels,
  hierarchies,
  people,
  currentUserId,
  isSuperAdmin = false,
  canEdit = true,
  canManageAccess = true,
}: {
  employees: EmployeeRow[];
  units: UnitOption[];
  departments: Option[];
  subdepartments: SubdeptOption[];
  positions: Option[];
  levels: Option[];
  hierarchies: Option[];
  people: Option[];
  currentUserId: string;
  /** dono do SaaS: pode gerir o papel Proprietário e agir sobre owners */
  isSuperAdmin?: boolean;
  /**
   * `false` deixa a ficha em consulta. A busca, os filtros, a tabela, a ficha
   * completa e a exportação continuam: quem só lê precisa exatamente disso. O
   * que some é cadastrar, importar, editar, inativar, redefinir senha e remover.
   */
  canEdit?: boolean;
  /**
   * O recorte do RH, um degrau dentro do `canEdit`: ele cadastra e corrige a
   * ficha, mas não mexe na CONTA. Some a redefinição de senha, a remoção, a
   * importação em lote (que cria conta com senha padrão) e o seletor de perfil
   * de acesso na ficha.
   *
   * A tela é só a primeira camada: a senha e a remoção param no
   * `adminActionContext`, e o perfil para no trigger `memberships_rh_nao_define_papel`,
   * dentro do banco.
   */
  canManageAccess?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeRow | undefined>(undefined);
  const [viewing, setViewing] = useState<EmployeeRow | null>(null);
  const [query, setQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [posFilter, setPosFilter] = useState("");
  const [hierFilter, setHierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);

  const router = useRouter();
  const [, startTransition] = useTransition();

  const openCreate = () => { setEditing(undefined); setOpen(true); };
  const openEdit = (e: EmployeeRow) => { setEditing(e); setOpen(true); };

  async function toggleActive(userId: string, makeActive: boolean, name: string | null) {
    // inativar corta o acesso da pessoa: confirma antes. Reativar é direto.
    if (!makeActive) {
      const ok = await confirmDialog({
        title: "Inativar colaborador",
        message: `Inativar ${name ?? "este colaborador"}? Ele perde o acesso ao sistema até ser reativado.`,
        confirmLabel: "Inativar",
        tone: "danger",
      });
      if (!ok) return;
    }
    const fd = new FormData();
    fd.set("user_id", userId);
    fd.set("active", String(makeActive));
    startTransition(async () => {
      const res = await setMemberActive(fd);
      if (res?.error) { toast.error(res.error); return; }
      toast.success(makeActive ? "Colaborador ativado." : "Colaborador inativado.");
      router.refresh();
    });
  }

  async function remove(userId: string, name: string | null) {
    const ok = await confirmDialog({
      title: "Excluir usuário",
      message: `Excluir ${name ?? "este usuário"}? Esta ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("user_id", userId);
    startTransition(async () => {
      const res = await removeUser(fd);
      if (res?.error) { toast.error(res.error); return; }
      toast.success(`${name ?? "Usuário"} removido.`);
      router.refresh();
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qd = onlyDigits(q);
    return employees.filter((e) => {
      if (q && !(
        (e.fullName ?? "").toLowerCase().includes(q) ||
        (e.employeeCode ?? "").toLowerCase().includes(q) ||
        (qd.length >= 3 && (e.cpf ?? "").includes(qd))
      )) return false;
      if (deptFilter && e.departmentId !== deptFilter) return false;
      if (posFilter && e.positionId !== posFilter) return false;
      if (hierFilter && e.hierarchyLevelId !== hierFilter) return false;
      if (statusFilter === "active" && !e.active) return false;
      if (statusFilter === "inactive" && e.active) return false;
      return true;
    });
  }, [employees, query, deptFilter, posFilter, hierFilter, statusFilter]);

  // sempre que os filtros mudam, volta para a primeira página
  useEffect(() => { setPage(1); }, [query, deptFilter, posFilter, hierFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const start = (pageClamped - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);
  const hasFilters = !!(query || deptFilter || posFilter || hierFilter || statusFilter !== "all");

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.9rem 1.1rem", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Colaboradores · {employees.length}</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="input"
            placeholder="Buscar por nome, CPF ou matrícula…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 280, padding: "0.4rem 0.7rem", fontSize: "0.85rem" }}
          />
          {canEdit && canManageAccess && <button className="btn btn-ghost btn-sm" onClick={() => setImportOpen(true)}><IconImport /> Importar em lote</button>}
          <ExportButton
            filename="colaboradores.xlsx"
            sheetName="Colaboradores"
            // A exportação tem as MESMAS colunas do modelo de importação, e só
            // elas: o arquivo exportado é o que volta pela importação, então toda
            // coluna daqui ou é lida na volta, ou é ruído que convida a ser
            // preenchida à toa. Por isso o gestor sai só como matrícula, sem o
            // nome. Para conferir o organograma com nomes, a tela é "Minha equipe".
            headers={["Empresa", "Código Funcionário", "Nome Completo", "Admissão", "Função", "Perfil Função", "Setor", "Sub Setor", "Data de Nascimento", "CPF", "Demissão", "Sexo", "Telefone", "E-mail", "Código Gestor", "Perfil", "Hierarquia"]}
            rows={employees.map((e) => {
              const brDate = (d: string | null) => (d && d.length >= 10 ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : (d ?? ""));
              return [e.unitNames.join("; "), e.employeeCode ?? "", e.fullName ?? "", brDate(e.admissionDate), e.positionName ?? "", e.levelName ?? "", e.departmentName ?? "", e.subdepartmentName ?? "", brDate(e.birthDate), e.cpf ?? "", brDate(e.dismissedAt), e.gender ?? "", e.phone ?? "", e.email ?? "", e.managerCode ?? "", roleLabel(e.role), e.hierarchyName ?? ""];
            })}
          />
          {canEdit && <button className="btn btn-primary btn-sm" onClick={openCreate}>+ Novo colaborador</button>}
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.75rem 1.1rem", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <select className="select" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} style={{ width: 200, padding: "0.4rem 0.7rem", fontSize: "0.85rem" }}>
          <option value="">Todos os setores</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="select" value={posFilter} onChange={(e) => setPosFilter(e.target.value)} style={{ width: 200, padding: "0.4rem 0.7rem", fontSize: "0.85rem" }}>
          <option value="">Todas as funções</option>
          {positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="select" value={hierFilter} onChange={(e) => setHierFilter(e.target.value)} style={{ width: 180, padding: "0.4rem 0.7rem", fontSize: "0.85rem" }}>
          <option value="">Toda a hierarquia</option>
          {hierarchies.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")} style={{ width: 160, padding: "0.4rem 0.7rem", fontSize: "0.85rem" }}>
          <option value="all">Todos os status</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
        {hasFilters && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setQuery(""); setDeptFilter(""); setPosFilter(""); setHierFilter(""); setStatusFilter("all"); }}>Limpar filtros</button>
        )}
      </div>

      {visible.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Matrícula</th>
              <th>CPF</th>
              <th>Colaborador</th>
              <th>Setor / Função</th>
              <th>Tipo</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => {
              const isSelf = e.userId === currentUserId;
              // owner só pode ser inativado/removido pelo dono do SaaS (super admin)
              const canAct = !isSelf && (e.role !== "owner" || isSuperAdmin);
              return (
                <tr key={e.userId} style={{ opacity: e.active ? 1 : 0.6 }}>
                  <td className="muted">{e.employeeCode ?? "—"}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{e.cpf ? formatCpf(e.cpf) : "—"}</td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", fontWeight: 600 }}>
                      <Avatar name={e.fullName} userId={e.userId} />
                      {e.fullName ?? "—"}
                      {isSelf && <span className="soft" style={{ fontSize: "0.72rem" }}>(você)</span>}
                    </span>
                  </td>
                  <td className="muted">
                    {e.departmentName ?? "—"}
                    {e.positionName && <div className="soft" style={{ fontSize: "0.75rem" }}>{e.positionName}{e.levelName ? ` · ${e.levelName}` : ""}</div>}
                    {e.hierarchyName && <div className="soft" style={{ fontSize: "0.72rem" }}>{e.hierarchyName}</div>}
                  </td>
                  <td><Badge tone={roleTone(e.role)}>{roleLabel(e.role)}</Badge></td>
                  <td><Badge tone={e.active ? "green" : "red"}>{e.active ? "Ativo" : "Inativo"}</Badge></td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: "0.3rem", justifyContent: "flex-end" }}>
                      <button className="icon-btn" type="button" title="Ver ficha completa" onClick={() => setViewing(e)}><Ico d={ICON.eye} /></button>
                      {canEdit && (
                        <>
                          <button className="icon-btn" title="Editar" onClick={() => openEdit(e)}><Ico d={ICON.edit} /></button>
                          {canAct && (
                            <button className="icon-btn" type="button" title={e.active ? "Inativar" : "Ativar"} onClick={() => toggleActive(e.userId, !e.active, e.fullName)}><Ico d={ICON.power} /></button>
                          )}
                          {canManageAccess && (
                            <FormModal triggerLabel={<Ico d={ICON.lock} />} triggerClassName="icon-btn" triggerTitle="Redefinir senha" title={`Redefinir senha · ${e.fullName ?? ""}`} action={setUserPassword} submitLabel="Salvar senha">
                              <input type="hidden" name="user_id" value={e.userId} />
                              <div>
                                <label className="label">Nova senha</label>
                                <PasswordInput autoComplete="new-password" minLength={8} placeholder="Mínimo 8 caracteres" />
                              </div>
                            </FormModal>
                          )}
                          {canAct && canManageAccess && (
                            <button className="icon-btn icon-btn-danger" type="button" title="Remover" onClick={() => remove(e.userId, e.fullName)}><Ico d={ICON.trash} /></button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <EmptyState title={hasFilters ? "Nenhum colaborador encontrado" : "Nenhum colaborador"} description={hasFilters ? "Tente outros filtros ou termo de busca." : undefined} />
      )}

      {filtered.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.75rem 1.1rem", fontSize: "0.82rem", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
          <span className="soft">
            {start + 1}–{Math.min(start + PAGE_SIZE, filtered.length)} de {filtered.length}
            {filtered.length !== employees.length ? ` (${employees.length} no total)` : ""}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <button className="btn btn-ghost btn-sm" disabled={pageClamped <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</button>
            <span className="muted">Página {pageClamped} de {totalPages}</span>
            <button className="btn btn-ghost btn-sm" disabled={pageClamped >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Próxima</button>
          </div>
        </div>
      )}

      {canEdit && (
        <>
          <EmployeeDialog
            open={open}
            onClose={() => setOpen(false)}
            employee={editing}
            units={units}
            departments={departments}
            subdepartments={subdepartments}
            positions={positions}
            levels={levels}
            hierarchies={hierarchies}
            people={people}
            canSetOwner={isSuperAdmin}
            canSetRole={canManageAccess}
          />

          {canManageAccess && <ImportEmployeesDialog open={importOpen} onClose={() => setImportOpen(false)} />}
        </>
      )}

      {viewing && (
        <EmployeeViewDialog employee={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}
