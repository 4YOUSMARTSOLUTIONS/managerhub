"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createEmployee, updateEmployee } from "@/lib/actions/employees";
import { initialActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { SearchSelect } from "@/components/SearchSelect";
import { GENDER, ROLE, UNIT_KIND, USER_TYPE, SEM_GESTOR, options } from "@/lib/constants";
import { formatCpf } from "@/lib/cpf";
import { AcessoTelasDaFicha } from "@/components/acesso/AcessoTelasDaFicha";

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
  /** marca de gestão de treinamentos (capacidade, independente do papel) */
  isTrainingManager?: boolean;
  /** marca de RH, o departamento pessoal (atribuição, independente do perfil) */
  isHr?: boolean;
  /** data de desligamento (demissão); null = vínculo ativo */
  dismissedAt?: string | null;
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

/**
 * O que a ficha está mudando e que é MOVIMENTAÇÃO: pede a data em que passou a
 * valer, porque a RV pesa cada função pelos dias do mês. Campo que estava vazio
 * e ganha valor é preenchimento, não movimentação (a mesma regra do banco, em
 * `admin_update_employee`, que é quem trava de verdade).
 */
function movimentacoesDaFicha(form: HTMLFormElement, e: EmployeeData, gestor: string): string[] {
  const fd = new FormData(form);
  const v = (k: string) => String(fd.get(k) ?? "") || null;
  const out: string[] = [];
  const mudou = (label: string, novo: string | null, atual: string | null) => {
    if (atual && novo !== atual) out.push(label);
  };
  const setor = v("department_id");
  if (e.departmentId && setor !== e.departmentId) out.push("Setor");
  // trocar o setor já é a movimentação; o subsetor vazio que ganha valor junto
  // vai nela, e sozinho é preenchimento
  mudou("Subsetor", v("subdepartment_id"), e.subdepartmentId);
  mudou("Função", v("position_id"), e.positionId);
  mudou("Nível", v("position_level_id"), e.positionLevelId);
  mudou("Hierarquia", v("hierarchy_level_id"), e.hierarchyLevelId);
  mudou("Gestor", gestor === SEM_GESTOR ? null : gestor || null, e.managerId);
  const unidades = fd.getAll("unit_ids").map(String).filter(Boolean).sort().join(",");
  const atuais = [...e.unitIds].sort().join(",");
  if (atuais && unidades !== atuais) out.push("Unidade");
  return out;
}

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
  canSetRole = true,
  subordinadosAtivos = 0,
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
  /**
   * `false` para o RH: ele cadastra e corrige a ficha, mas o perfil de acesso
   * não é dele. No cadastro novo o campo some e a pessoa entra como Funcionário;
   * na edição mostra o perfil atual, apenas para leitura.
   *
   * O `role` não é enviado nesse caso, e as duas RPCs tratam a ausência como
   * "mantém o que está" (`coalesce(nullif(...), role)`). Ainda assim o trigger
   * `memberships_rh_nao_define_papel` recusaria a troca no banco.
   */
  canSetRole?: boolean;
  /**
   * Quantas pessoas ativas têm este colaborador como gestor: ao desligá-lo, elas
   * continuam apontando para ele até alguém trocar o gestor delas.
   */
  subordinadosAtivos?: number;
}) {
  const isEdit = !!employee;
  // A data de desligamento em edição vale para ESTA abertura da ficha: trocou de
  // colaborador (ou reabriu), a chave muda e o campo volta ao que está gravado,
  // sem efeito sincronizando estado.
  const chaveDeslig = `${open}|${employee?.userId ?? ""}|${employee?.dismissedAt ?? ""}`;
  const [desligEstado, setDesligEstado] = useState({ chave: chaveDeslig, valor: employee?.dismissedAt ?? "" });
  const desligamento = desligEstado.chave === chaveDeslig ? desligEstado.valor : (employee?.dismissedAt ?? "");
  const setDesligamento = (valor: string) => setDesligEstado({ chave: chaveDeslig, valor });
  const hojeSP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const action = isEdit ? updateEmployee : createEmployee;
  const [state, formAction] = useActionState(action, initialActionState);
  // setor selecionado (campo controlado): mesma técnica, reabrir ou trocar de
  // colaborador volta ao setor gravado
  const chaveDept = `${open}|${employee?.userId ?? ""}|${employee?.departmentId ?? ""}`;
  const [deptEstado, setDeptEstado] = useState({ chave: chaveDept, valor: employee?.departmentId ?? "" });
  const deptId = deptEstado.chave === chaveDept ? deptEstado.valor : (employee?.departmentId ?? "");
  const setDeptId = (valor: string) => setDeptEstado({ chave: chaveDept, valor });
  // gestor escolhido (campo com busca): mesma técnica. Na edição de quem não
  // tem gestor, "Sem gestor" vem marcado, senão a ficha abriria inválida.
  const gestorInicial = employee?.managerId ?? (isEdit ? SEM_GESTOR : "");
  const chaveGestor = `${open}|${employee?.userId ?? ""}|${gestorInicial}`;
  const [gestorEstado, setGestorEstado] = useState({ chave: chaveGestor, valor: gestorInicial });
  const gestor = gestorEstado.chave === chaveGestor ? gestorEstado.valor : gestorInicial;
  const setGestor = (valor: string) => setGestorEstado({ chave: chaveGestor, valor });
  // movimentações que esta edição faz (pede a data); mesma técnica de chave
  const formRef = useRef<HTMLFormElement>(null);
  const chaveMov = `${open}|${employee?.userId ?? ""}`;
  const [movEstado, setMovEstado] = useState<{ chave: string; valor: string[] }>({ chave: chaveMov, valor: [] });
  const movimentacoes = movEstado.chave === chaveMov ? movEstado.valor : [];
  // lido DEPOIS de o React pintar a mudança: trocar o setor recria o select de
  // subsetor, e é o valor novo dele que conta
  const recalcularMovimentacoes = (gestorAgora = gestor) => {
    if (!employee) return;
    setTimeout(() => {
      if (!formRef.current) return;
      const lista = movimentacoesDaFicha(formRef.current, employee, gestorAgora);
      setMovEstado((s) => (s.chave === chaveMov && s.valor.join("|") === lista.join("|") ? s : { chave: chaveMov, valor: lista }));
    }, 0);
  };
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      onClose();
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!open) return null;

  // mostra só ativos, mas preserva o que já está atribuído ao colaborador (ao editar)
  const act = <T extends { active?: boolean; id: string }>(list: T[], sel: string | null | undefined) =>
    list.filter((o) => o.active !== false || o.id === sel);
  const deptList = act(departments, employee?.departmentId);
  const positionList = act(positions, employee?.positionId);
  const levelList = act(levels, employee?.positionLevelId);
  const hierarchyList = act(hierarchies, employee?.hierarchyLevelId);
  const subs = act(subdepartments.filter((s) => s.department_id === deptId), employee?.subdepartmentId);
  // Gestor: só ativos, de A a Z, menos a própria pessoa. O gestor atual fica na
  // lista mesmo inativo (marcado), para salvar a ficha não trocá-lo sozinho.
  const gestorOpcoes = [
    { id: SEM_GESTOR, name: "Sem gestor (topo da hierarquia)" },
    ...act(people, employee?.managerId)
      .filter((p) => p.id !== employee?.userId)
      .map((p) => ({ id: p.id, name: p.active === false ? `${p.name} (inativo)` : p.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  ];

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 1rem", zIndex: 70, overflowY: "auto" }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 720, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{isEdit ? "Editar colaborador" : "Novo colaborador"}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <form action={formAction} ref={formRef} onChange={() => recalcularMovimentacoes()}>
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
              <Field label="Tipo de usuário" req={canSetRole}>
                {!canSetRole ? (
                  <input className="input" value={employee ? (ROLE[employee.role as keyof typeof ROLE] ?? employee.role) : ROLE.member} disabled />
                ) : employee?.role === "owner" && !canSetOwner ? (
                  <>
                    <input type="hidden" name="role" value="owner" />
                    <input className="input" value={ROLE.owner} disabled />
                  </>
                ) : (
                  <select name="role" className="select" required defaultValue={employee?.role ?? "member"}>
                    {canSetOwner && <option value="owner">{ROLE.owner}</option>}
                    {/* "RH" saiu da lista: virou a marca logo abaixo. A opção só volta
                        para quem ainda está com o perfil antigo, senão o seletor
                        mostraria outro perfil e salvar trocaria o dele sem aviso. */}
                    {Object.entries(USER_TYPE)
                      .filter(([value]) => value !== "hr" || employee?.role === "hr")
                      .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                )}
              </Field>
            </div>
            {/* Gestão de treinamentos: uma capacidade, não um perfil. A analista
                que cuida dos treinamentos continua Analista no resto do sistema e
                ganha só este módulo. Aparece para quem define perfil de acesso
                (owner/admin), porque conceder acesso é da administração; no
                banco, uma trava recusa a marca vinda de qualquer outro papel. */}
            {canSetRole && isEdit && (
              <>
                <input type="hidden" name="gestao_treinamentos_presente" value="1" />
                {/* RH: atribuição, não perfil. Combina com qualquer tipo de usuário:
                    a pessoa do DP que também chefia gente fica Gestor e marca isto. */}
                <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer", fontSize: "0.85rem" }}>
                  <input type="checkbox" name="is_hr" value="1" defaultChecked={employee?.isHr ?? false} style={{ marginTop: 3 }} />
                  <span>
                    <strong>RH (departamento pessoal)</strong>
                    <span className="soft" style={{ display: "block", fontSize: "0.76rem" }}>
                      Cuida do cadastro de colaboradores, férias, afastamentos, absenteísmos, punições e
                      remuneração variável da empresa inteira. Não muda o tipo de usuário: quem chefia uma
                      equipe continua vendo a equipe como Gestor.
                    </span>
                  </span>
                </label>
                <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer", fontSize: "0.85rem" }}>
                  <input type="checkbox" name="is_training_manager" value="1" defaultChecked={employee?.isTrainingManager ?? false} style={{ marginTop: 3 }} />
                  <span>
                    <strong>Gestão de treinamentos</strong>
                    <span className="soft" style={{ display: "block", fontSize: "0.76rem" }}>
                      Cria e edita treinamentos, trilhas, turmas e provas, convoca pessoas e acompanha o
                      progresso de todos. Não muda o tipo de usuário nem dá acesso a outros módulos.
                    </span>
                  </span>
                </label>
                {/* telas liberadas: regra do nível ou exceção, gravada na hora */}
                {employee && <AcessoTelasDaFicha userId={employee.userId} nome={employee.fullName ?? "colaborador"} />}
              </>
            )}
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
                {/* Obrigatório RESPONDER, não obrigatório TER. "Sem gestor" é uma
                    opção da lista: o vazio continua travando (ninguém fica órfão
                    por esquecimento), e quem está no topo da empresa deixa de
                    ser impossível de salvar. Na edição de quem já não tem
                    gestor, a opção vem escolhida, senão a ficha abriria inválida
                    para mexer em qualquer outro campo. */}
                <div style={{ position: "relative" }}>
                  <SearchSelect
                    options={gestorOpcoes}
                    value={gestor}
                    onChange={(v) => { setGestor(v); recalcularMovimentacoes(v); }}
                    placeholder="Digite para buscar o gestor…"
                    maxVisible={gestorOpcoes.length}
                  />
                  {/* leva o valor no formulário e trava o envio vazio com o aviso
                      nativo do navegador, como o select fazia */}
                  <input
                    name="manager_id" required value={gestor} onChange={() => {}}
                    tabIndex={-1} aria-hidden
                    style={{ position: "absolute", left: 12, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                  />
                </div>
              </Field>
            </div>

            {/* Só aparece quando a edição muda algo que é movimentação, e aí é
                obrigatória: a RV do mês é pesada pelos dias de cada função. */}
            {isEdit && movimentacoes.length > 0 && (
              <div style={{ padding: "0.75rem 0.85rem", borderRadius: 9, background: "var(--surface-2)" }}>
                <div style={grid2}>
                  <Field label="Data da mudança" req>
                    <input name="effective_date" type="date" className="input" required max={hojeSP} />
                  </Field>
                  <p className="soft" style={{ fontSize: "0.76rem", margin: "1.4rem 0 0" }}>
                    Esta edição muda <strong>{movimentacoes.join(", ")}</strong>. Informe o primeiro dia
                    na situação nova: o histórico e a variável do mês contam a partir dele.
                  </p>
                </div>
              </div>
            )}

            {isEdit && (
              <>
                <p style={sectionTitle}>Desligamento</p>
                {/* o marcador diz ao servidor que o campo estava na tela: sem ele,
                    "vazio" não distinguiria "não desligado" de "campo ausente" */}
                <input type="hidden" name="desligamento_presente" value="1" />
                <div style={grid2}>
                  <Field label="Data de desligamento">
                    <input
                      name="dismissed_at" type="date" className="input"
                      value={desligamento} max={hojeSP}
                      onChange={(e) => setDesligamento(e.target.value)}
                    />
                    <p className="soft" style={{ fontSize: "0.72rem", margin: "0.3rem 0 0" }}>
                      Preencha para desligar: o colaborador perde o acesso e sai das listas de
                      ativos. Para desfazer um desligamento lançado por engano, apague a data.
                    </p>
                  </Field>
                </div>
                {desligamento && !employee?.dismissedAt && (
                  <p style={{ fontSize: "0.8rem", margin: 0, padding: "0.5rem 0.7rem", borderRadius: 8, background: "var(--mh-warning-soft)", color: "var(--mh-warning)" }}>
                    Ao salvar, o colaborador será desligado em {desligamento.split("-").reverse().join("/")} e perderá o acesso ao sistema.
                    {subordinadosAtivos > 0 && ` Ele é gestor de ${subordinadosAtivos} pessoa(s) ativa(s): troque o gestor delas depois.`}
                  </p>
                )}
                {!desligamento && employee?.dismissedAt && (
                  <p style={{ fontSize: "0.8rem", margin: 0, padding: "0.5rem 0.7rem", borderRadius: 8, background: "var(--mh-warning-soft)", color: "var(--mh-warning)" }}>
                    Ao salvar, o desligamento é desfeito e o colaborador volta a ter acesso.
                  </p>
                )}
              </>
            )}

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
