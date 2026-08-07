import { requireContext, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormModal } from "@/components/ui/FormModal";
import { CompanyForm } from "@/components/CompanyForm";
import { Eye, Pencil, Power, RotateCcw, Trash2 } from "lucide-react";
import { RegistryList } from "@/components/RegistryList";
import { ImportSdpoDialog } from "@/components/ImportSdpoDialog";
import { ImportStructureDialog } from "@/components/ImportStructureDialog";
import { ImportListDialog } from "@/components/ImportListDialog";
import { ConfirmActionButton } from "@/components/ui/ConfirmActionButton";
import { TicketSlaEditor } from "@/components/TicketSlaEditor";
import { ImportTicketStructureDialog } from "@/components/ImportTicketStructureDialog";
import { ImportTicketSlaDialog } from "@/components/ImportTicketSlaDialog";
import { TicketManagersEditor } from "@/components/TicketManagersEditor";
import { RvConfigEditor } from "@/components/RvConfigEditor";
import { addFeedbackCompetencyForm, removeFeedbackCompetencyForm, toggleFeedbackCompetencyForm } from "@/lib/actions/feedbacks";
import { FeedbackCadenceEditor } from "@/components/FeedbackCadenceEditor";
import { UnitsManager } from "@/components/UnitsManager";
import { UsersManager, type EmployeeRow } from "@/components/UsersManager";
import { AbsencesManager, type AbsenceRow } from "@/components/AbsencesManager";
import { SanctionsManager, type SanctionRow } from "@/components/SanctionsManager";
import { RvReducerEditor, type RegraRow } from "@/components/RvReducerEditor";
import {
  createSanctionType, deleteSanctionType, setSanctionTypeActive,
} from "@/lib/actions/rv-redutores";
import { createRoom, updateRoom, toggleRoom, deleteRoom } from "@/lib/actions/rooms";
import { createHoliday, deleteHoliday } from "@/lib/actions/holidays";
import { ImportHolidaysDialog } from "@/components/ImportHolidaysDialog";
import { ExportButton } from "@/components/ui/ExportButton";
import { PRIORITY, TICKET_SLA_UNIT } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import {
  createDepartment, deleteDepartment, setDepartmentActive,
  createSubdepartment, deleteSubdepartment, setSubdepartmentActive,
  createPosition, deletePosition, setPositionActive,
  createPositionLevel, deletePositionLevel, setPositionLevelActive,
  createHierarchyLevel, deleteHierarchyLevel, setHierarchyLevelActive, moveHierarchyLevel,
} from "@/lib/actions/registry";
import {
  createProgram, deleteProgram, setProgramActive,
  createPilar, deletePilar, setPilarActive,
  createSecao, deleteSecao, setSecaoActive,
  createBloco, deleteBloco, setBlocoActive, createItem, deleteItem, setItemActive,
  createKpi, deleteKpi, setKpiActive, createTool, deleteTool, setToolActive,
  importKpis, importTools,
} from "@/lib/actions/sdpo";
import {
  createTicketSector, deleteTicketSector, setTicketSectorActive,
  createTicketCategory, deleteTicketCategory, setTicketCategoryActive,
} from "@/lib/actions/tickets";

export default async function SettingsPage() {
  const { tenant, role, user, isSuperAdmin, unitScope } = await requireContext();

  // Duas perguntas separadas, e é a separação que sustenta a tela inteira.
  //
  // O Gerencial ENTRA e lê tudo: catálogos, estrutura, colaboradores (dados
  // pessoais inclusive), remuneração variável, férias, SLA. O que ele não faz é
  // gravar. `canEdit` desce até o último botão, e a recusa de verdade está em
  // três camadas atrás dele: a RLS, o `adminActionContext` das server actions e
  // as guardas dentro das RPCs `admin_*`. A tela é só a primeira.
  const canView = role === "owner" || role === "admin" || role === "manager";
  const canEdit = role === "owner" || role === "admin";

  if (!canView) {
    return (
      <div>
        <PageHeader title="Configurações" />
        <EmptyState title="Acesso restrito" description="Apenas proprietários, administradores e o perfil Gerencial podem acessar as configurações." />
      </div>
    );
  }

  /** Importar é escrita; exportar é leitura. Quem só lê fica com a segunda. */
  const seEdita = (node: React.ReactNode) => (canEdit ? node : null);

  const supabase = await createClient();
  // Tudo o que a tela precisa numa rodada só. Antes eram 6 ondas em sequência, e
  // como nenhuma dependia da anterior, a espera era pura soma de latência: com o
  // banco em São Paulo, cada onda custava um ida e volta que não precisava existir.
  const [
    { data: memberships }, { data: units }, { data: departments },
    { data: subdepartments }, { data: positions }, { data: levels }, { data: hierarchies }, { data: rooms }, { data: holidays },
    { data: programas }, { data: pilares }, { data: secoes }, { data: blocos }, { data: itens }, { data: kpis }, { data: tools },
    { data: ticketSectors }, { data: ticketCategories }, { data: ticketSlas }, { data: rvConfigsData }, { data: fbCompsData }, { data: fbCadenceRules },
    { data: usoData }, { data: profilesData }, { data: pessoaisData }, { data: muData }, { data: absencesData },
    { data: sanctionTypesData }, { data: sanctionsData }, { data: reducerRulesData }, { data: reducerBandsData },
  ] = await Promise.all([
    supabase.from("memberships").select("*").eq("tenant_id", tenant.id),
    supabase.from("units").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("departments").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("subdepartments").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("positions").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("position_levels").select("*").eq("tenant_id", tenant.id).order("name"),
    // ordena por `rank`, nao por nome: hierarquia tem ordem propria, e
    // alfabetica poria "Analista" acima de "Diretoria"
    supabase.from("hierarchy_levels").select("*").eq("tenant_id", tenant.id).order("rank").order("name"),
    supabase.from("rooms").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("holidays").select("*").eq("tenant_id", tenant.id).order("day"),
    supabase.from("sdpo_programas").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("sdpo_pilares").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("sdpo_secoes").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("sdpo_blocos").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("sdpo_itens").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("action_kpis").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("action_tools").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("ticket_sectors").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("ticket_categories").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("ticket_slas").select("*").eq("tenant_id", tenant.id),
    supabase.from("individual_rv_config").select("id, scope, position_id, user_id, effective_from, value").eq("tenant_id", tenant.id).order("effective_from", { ascending: false }),
    supabase.from("feedback_competencies").select("id, name, active").eq("tenant_id", tenant.id).order("sort").order("name"),
    supabase.from("feedback_cadence_rules").select("id, department_id, position_id, cadence_days").eq("tenant_id", tenant.id),
    supabase.rpc("catalog_usage", { p_tenant: tenant.id }),
    // RLS já limita ao tenant — evita .in() com centenas de ids (estoura a URL do PostgREST)
    supabase.from("profiles").select("id, full_name, email").limit(5000),
    // CPF, telefone, nascimento e sexo saíram do alcance da chave pública: a RLS
    // libera a LINHA do colega e não tem granularidade de coluna, então qualquer
    // funcionário lia a base inteira pelo PostgREST. Vêm por RPC, que exige
    // owner/admin da empresa ativa.
    supabase.rpc("tenant_dados_pessoais", { p_tenant: tenant.id }),
    supabase.from("membership_units").select("membership_id, unit_id").limit(20000),
    // férias e afastamentos: a RLS é owner/admin, e esta tela já é
    supabase
      .from("employee_absences")
      .select("id, user_id, kind, start_date, end_date, discounts_rv, note")
      .eq("tenant_id", tenant.id)
      .order("start_date", { ascending: false }),
    // Redutores da RV. Catálogo e regras são configuração (qualquer membro lê);
    // a punição em si é disciplinar, e a RLS é owner/admin/manager.
    supabase.from("sanction_types").select("id, name, active").eq("tenant_id", tenant.id).order("sort").order("name"),
    supabase
      .from("employee_sanctions")
      .select("id, user_id, sanction_type_id, occurred_on, note")
      .eq("tenant_id", tenant.id)
      .order("occurred_on", { ascending: false }),
    supabase.from("rv_reducer_rules").select("id, name, source, absence_kind, sanction_type_id, active").eq("tenant_id", tenant.id).order("sort").order("name"),
    supabase.from("rv_reducer_bands").select("id, rule_id, min_qtd, max_qtd, reduction_pct").eq("tenant_id", tenant.id).order("min_qtd"),
  ]);

  // ids já usados — excluir só é permitido quando nunca usado (senão: desativar).
  // Antes esta tela baixava a tabela de AÇÕES INTEIRA (7.522 linhas) e todos os
  // chamados só para montar estes conjuntos. Agora a conta é feita no banco e volta
  // apenas a lista de ids em uso.
  const uso = usoData?.[0];
  const conjunto = (ids: string[] | null | undefined) => new Set<string>(ids ?? []);
  const usedPilar = conjunto(uso?.pilar_ids);
  const usedSecao = conjunto(uso?.secao_ids);
  const usedBloco = conjunto(uso?.bloco_ids);
  const usedItem = conjunto(uso?.item_ids);
  const usedKpi = conjunto(uso?.kpi_ids);
  const usedTool = conjunto(uso?.tool_ids);
  const usedDept = conjunto(uso?.department_ids);
  const usedSubdept = conjunto(uso?.subdepartment_ids);
  const usedPosition = conjunto(uso?.position_ids);
  const usedLevel = conjunto(uso?.level_ids);
  const usedSector = conjunto(uso?.sector_ids);
  const usedCategory = conjunto(uso?.category_ids);
  const usedCompetency = conjunto(uso?.competency_ids);

  const mems = memberships ?? [];

  // mapas de apoio
  //
  // São DOIS mapas de propósito, e trocar um pelo outro seria regressão silenciosa:
  // `profById` é o que a RLS deixa ver (para super admin, o universo de perfis) e
  // alimenta o seletor de gestor, o nome do gestor e a lista de RV. `pessoaisById`
  // vem da RPC, que devolve só quem tem vínculo com a empresa ativa. Um gestor fora
  // desse recorte viraria "—" na tela sem nenhum erro aparecer.
  const profById = new Map((profilesData ?? []).map((p) => [p.id, p]));
  const pessoaisById = new Map((pessoaisData ?? []).map((d) => [d.id, d]));
  const unitById = new Map((units ?? []).map((u) => [u.id, u]));
  const deptById = new Map((departments ?? []).map((d) => [d.id, d]));
  const subById = new Map((subdepartments ?? []).map((s) => [s.id, s]));
  const posById = new Map((positions ?? []).map((p) => [p.id, p]));
  const levelById = new Map((levels ?? []).map((l) => [l.id, l]));
  const hierById = new Map((hierarchies ?? []).map((h) => [h.id, h]));
  // matrícula por usuário: a exportação leva o CÓDIGO do gestor além do nome,
  // porque é ele a chave estável na reimportação (nome pode ganhar homônimo)
  const codeByUser = new Map(mems.map((m) => [m.user_id, m.employee_code]));
  const unitsByMem = new Map<string, string[]>();
  for (const mu of muData ?? []) {
    const arr = unitsByMem.get(mu.membership_id) ?? [];
    arr.push(mu.unit_id);
    unitsByMem.set(mu.membership_id, arr);
  }

  const employeesTodos: EmployeeRow[] = mems.map((m) => {
    const p = profById.get(m.user_id);
    const d = pessoaisById.get(m.user_id);
    const uIds = unitsByMem.get(m.id) ?? [];
    return {
      userId: m.user_id,
      fullName: p?.full_name ?? null,
      email: p?.email ?? null,
      cpf: d?.cpf ?? null,
      phone: d?.phone ?? null,
      birthDate: d?.birth_date ?? null,
      gender: d?.gender ?? null,
      role: m.role,
      employeeCode: m.employee_code,
      admissionDate: m.admission_date,
      departmentId: m.department_id,
      subdepartmentId: m.subdepartment_id,
      positionId: m.position_id,
      positionLevelId: m.position_level_id,
      hierarchyLevelId: m.hierarchy_level_id,
      managerId: m.manager_id,
      unitIds: uIds,
      departmentName: m.department_id ? deptById.get(m.department_id)?.name ?? null : null,
      subdepartmentName: m.subdepartment_id ? subById.get(m.subdepartment_id)?.name ?? null : null,
      dismissedAt: m.dismissed_at ?? null,
      positionName: m.position_id ? posById.get(m.position_id)?.name ?? null : null,
      levelName: m.position_level_id ? levelById.get(m.position_level_id)?.name ?? null : null,
      hierarchyName: m.hierarchy_level_id ? hierById.get(m.hierarchy_level_id)?.name ?? null : null,
      managerName: m.manager_id ? profById.get(m.manager_id)?.full_name ?? null : null,
      managerCode: m.manager_id ? codeByUser.get(m.manager_id) ?? null : null,
      unitNames: uIds.map((id) => unitById.get(id)?.name).filter((x): x is string => !!x),
      active: m.is_active,
    };
  })
    // Ordenado pela MATRÍCULA, e como NÚMERO.
    //
    // A coluna é `text` no banco, então uma ordenação comum sairia
    // 1, 10, 100, 1000, 101, 11, 2..., que parece defeito. Comparar como número
    // resolve, mas só vale para quem tem matrícula puramente numérica: hoje são
    // 987 de 987, e isso é estado dos dados, não garantia do schema. Quem fugir
    // disso (ou não tiver matrícula) vai para o fim, em ordem de nome, em vez de
    // virar `NaN` e embaralhar a lista inteira.
    //
    // Vale também para a exportação, que sai desta mesma lista.
    .sort((a, b) => {
      const numerica = (v: string | null) => v != null && /^\d+$/.test(v);
      const na = numerica(a.employeeCode);
      const nb = numerica(b.employeeCode);
      if (na && nb) return Number(a.employeeCode) - Number(b.employeeCode);
      if (na !== nb) return na ? -1 : 1;
      return (a.fullName ?? "").localeCompare(b.fullName ?? "", "pt-BR");
    });

  // O seletor de unidade do topo vale AQUI TAMBÉM.
  //
  // Esta lista saía com a empresa inteira mesmo com uma unidade escolhida lá em
  // cima, e como a exportação nasce dela, o xlsx vinha com todo mundo junto.
  //
  // Quem não tem NENHUMA unidade aparece em qualquer recorte, de propósito: é a
  // mesma regra que /acoes e /checklists já aplicam a registro sem unidade. Sem
  // isso, um cadastro novo sem unidade sumiria de todas as telas menos "Todas",
  // e sumir sem erro é pior que aparecer demais.
  //
  // Só a LISTA é recortada. `mems`, `codeByUser` e `usedHierarchy` continuam com
  // a empresa inteira: o nome do gestor de outra unidade tem de continuar
  // resolvendo, e "catálogo em uso" que só olhasse a unidade ativa deixaria
  // excluir uma hierarquia ainda usada na outra.
  const unidadesDoEscopo = effectiveUnitFilter(unitScope);
  const employees = unidadesDoEscopo
    ? employeesTodos.filter((e) => e.unitIds.length === 0 || e.unitIds.some((id) => unidadesDoEscopo.includes(id)))
    : employeesTodos;

  const people = (profilesData ?? []).map((p) => ({ id: p.id, name: p.full_name ?? p.email ?? "—" }));
  const unitOpts = (units ?? []).map((u) => ({ id: u.id, name: u.name, kind: u.kind }));
  const deptOpts = (departments ?? []).map((d) => ({ id: d.id, name: d.name, active: d.active }));
  const subOpts = (subdepartments ?? []).map((s) => ({ id: s.id, name: s.name, department_id: s.department_id, active: s.active }));
  const posOpts = (positions ?? []).map((p) => ({ id: p.id, name: p.name, active: p.active }));
  const levelOpts = (levels ?? []).map((l) => ({ id: l.id, name: l.name, active: l.active }));
  const hierarchyOpts = (hierarchies ?? []).map((h) => ({ id: h.id, name: h.name, active: h.active }));
  // "em uso" sai dos vinculos que a pagina JA carregou, sem ida extra ao banco
  const usedHierarchy = new Set(mems.map((m) => m.hierarchy_level_id).filter((x): x is string => !!x));

  // remuneração variável (metas individuais)
  const rvConfigs = (rvConfigsData ?? []).map((c) => ({
    id: c.id,
    scope: c.scope as "position" | "user",
    positionId: c.position_id,
    userId: c.user_id,
    effectiveFrom: c.effective_from,
    value: c.value,
  }));
  const rvMembers = mems
    .filter((m) => m.is_active)
    .map((m) => ({
      userId: m.user_id,
      name: profById.get(m.user_id)?.full_name ?? profById.get(m.user_id)?.email ?? "—",
      positionId: m.position_id,
      positionName: m.position_id ? posById.get(m.position_id)?.name ?? null : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const sanctionTypeOpts = (sanctionTypesData ?? []).map((t) => ({ id: t.id, name: t.name, active: t.active }));
  const sanctionTypeName = new Map(sanctionTypeOpts.map((t) => [t.id, t.name]));
  const sanctionRows: SanctionRow[] = (sanctionsData ?? []).map((s2) => ({
    id: s2.id,
    userId: s2.user_id,
    typeId: s2.sanction_type_id,
    typeName: sanctionTypeName.get(s2.sanction_type_id) ?? "—",
    occurredOn: s2.occurred_on,
    note: s2.note,
  }));
  const faixasPorRegra = new Map<string, { id: string; min: number; max: number | null; pct: number }[]>();
  for (const b of reducerBandsData ?? []) {
    const arr = faixasPorRegra.get(b.rule_id) ?? [];
    arr.push({ id: b.id, min: b.min_qtd, max: b.max_qtd, pct: Number(b.reduction_pct) });
    faixasPorRegra.set(b.rule_id, arr);
  }
  const reducerRules: RegraRow[] = (reducerRulesData ?? []).map((r) => ({
    id: r.id, nome: r.name, fonte: r.source, absenceKind: r.absence_kind,
    sanctionTypeId: r.sanction_type_id, ativa: r.active,
    faixas: faixasPorRegra.get(r.id) ?? [],
  }));
  // se nenhum motivo ativo observa punição, registrar uma não muda valor nenhum
  const punicaoCortaRv = reducerRules.some((r) => r.ativa && r.fonte === "sanction" && r.faixas.length > 0);

  const absenceRows: AbsenceRow[] = (absencesData ?? []).map((a) => ({
    id: a.id,
    userId: a.user_id,
    kind: a.kind,
    startDate: a.start_date,
    endDate: a.end_date,
    discountsRv: a.discounts_rv,
    note: a.note,
  }));

  // ---------- Conteúdo das abas ----------
  const empresaTab = (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 760 }}>
      <Section title="Dados da empresa">
        <CompanyForm name={tenant.name} canEdit={role === "owner"} />
      </Section>
      <UnitsManager
        canEdit={canEdit}
        units={(units ?? []).map((u) => ({ id: u.id, name: u.name, kind: u.kind, cnpj: u.cnpj }))}
        unitLimit={tenant.units_limit}
      />
    </div>
  );

  // Férias moram DENTRO de Colaboradores, e não numa aba de topo: é dado por
  // pessoa, e a barra de cima já tem nove itens. Quem procura "férias" procura no
  // cadastro de gente.
  const usuariosTab = (
    <Tabs
      variant="sub"
      tabs={[
        {
          id: "cadastro",
          label: "Cadastro",
          content: (
            <UsersManager
              employees={employees}
              units={unitOpts}
              departments={deptOpts}
              subdepartments={subOpts}
              positions={posOpts}
              levels={levelOpts}
              hierarchies={hierarchyOpts}
              people={people}
              currentUserId={user.id}
              isSuperAdmin={isSuperAdmin}
              canEdit={canEdit}
            />
          ),
        },
        {
          id: "ausencias",
          label: "Férias e afastamentos",
          content: <AbsencesManager members={rvMembers.map((m) => ({ id: m.userId, name: m.name }))} absences={absenceRows} canEdit={canEdit} />,
        },
        {
          id: "punicoes",
          label: "Punições",
          content: (
            <SanctionsManager
              members={rvMembers.map((m) => ({ id: m.userId, name: m.name }))}
              types={sanctionTypeOpts}
              sanctions={sanctionRows}
              cortaRv={punicaoCortaRv}
              canEdit={canEdit}
            />
          ),
        },
      ]}
    />
  );

  const estruturaTab = (
    <Tabs
      variant="sub"
      tabs={[
        {
          id: "setores",
          label: "Setores",
          content: <RegistryList canEdit={canEdit} title="Setores" items={deptOpts.map((d) => ({ ...d, canDelete: !usedDept.has(d.id) }))} createAction={createDepartment} deleteAction={deleteDepartment} toggleAction={setDepartmentActive} placeholder="Nome do setor" headerAction={<>{seEdita(<ImportStructureDialog />)}<ExportButton filename="setores.xlsx" sheetName="Estrutura" headers={["Setor", "Subsetor", "Função"]} rows={deptOpts.map((d) => [d.name, "", ""])} /></>} />,
        },
        {
          id: "subsetores",
          label: "Subsetores",
          content: (
            <RegistryList
              canEdit={canEdit}
              title="Subsetores"
              items={subOpts.map((s) => ({ id: s.id, name: s.name, meta: deptById.get(s.department_id)?.name ?? undefined, active: s.active, canDelete: !usedSubdept.has(s.id) }))}
              createAction={createSubdepartment}
              deleteAction={deleteSubdepartment}
              toggleAction={setSubdepartmentActive}
              placeholder="Nome do subsetor"
              metaLabel="Setor"
              emptyText="Nenhum subsetor. Cadastre setores primeiro."
              headerAction={<>{seEdita(<ImportStructureDialog />)}<ExportButton filename="subsetores.xlsx" sheetName="Estrutura" headers={["Setor", "Subsetor", "Função"]} rows={subOpts.map((s) => [deptById.get(s.department_id)?.name ?? "", s.name, ""])} /></>}
              extraFields={
                <select name="department_id" className="select" required style={{ width: "auto" }}>
                  <option value="">Setor…</option>
                  {deptOpts.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              }
            />
          ),
        },
        {
          id: "funcoes",
          label: "Funções",
          content: <RegistryList canEdit={canEdit} title="Funções" items={posOpts.map((p) => ({ ...p, canDelete: !usedPosition.has(p.id) }))} createAction={createPosition} deleteAction={deletePosition} toggleAction={setPositionActive} placeholder="Nome da função" headerAction={<>{seEdita(<ImportStructureDialog />)}<ExportButton filename="funcoes.xlsx" sheetName="Estrutura" headers={["Setor", "Subsetor", "Função"]} rows={posOpts.map((p) => ["", "", p.name])} /></>} />,
        },
        {
          id: "hierarquia",
          label: "Hierarquia",
          content: (
            <RegistryList
              canEdit={canEdit}
              title="Hierarquia"
              description="Nível na estrutura da empresa, do topo para a base. Não confundir com Perfis de função (Júnior, Pleno), que é a senioridade dentro do cargo."
              items={hierarchyOpts.map((h) => ({ ...h, canDelete: !usedHierarchy.has(h.id) }))}
              createAction={createHierarchyLevel}
              deleteAction={deleteHierarchyLevel}
              toggleAction={setHierarchyLevelActive}
              placeholder="Ex.: Coordenação"
              rowActions={(it) => (
                <>
                  <form action={moveHierarchyLevel} style={{ display: "inline-flex" }}>
                    <input type="hidden" name="id" value={it.id} />
                    <input type="hidden" name="dir" value="up" />
                    <button className="icon-btn" type="submit" title="Subir" aria-label="Subir">↑</button>
                  </form>
                  <form action={moveHierarchyLevel} style={{ display: "inline-flex" }}>
                    <input type="hidden" name="id" value={it.id} />
                    <input type="hidden" name="dir" value="down" />
                    <button className="icon-btn" type="submit" title="Descer" aria-label="Descer">↓</button>
                  </form>
                </>
              )}
            />
          ),
        },
        {
          id: "perfis",
          label: "Perfis de função",
          content: <RegistryList canEdit={canEdit} title="Perfis de função" description="Ex.: Júnior, Pleno, Sênior." items={levelOpts.map((l) => ({ ...l, canDelete: !usedLevel.has(l.id) }))} createAction={createPositionLevel} deleteAction={deletePositionLevel} toggleAction={setPositionLevelActive} placeholder="Ex.: Júnior, Pleno, Sênior" />,
        },
      ]}
    />
  );

  const salasTab = (
    <div style={{ maxWidth: 760 }}>
    <Section
      title={`Salas de reunião · ${rooms?.length ?? 0}`}
      padded={false}
      action={seEdita(
        <FormModal triggerLabel="+ Nova sala" title="Nova sala" action={createRoom} submitLabel="Criar sala">
          <div>
            <label className="label">Nome</label>
            <input name="name" className="input" required placeholder="Sala Principal" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: "0.8rem" }}>
            <div>
              <label className="label">Localização</label>
              <input name="location" className="input" placeholder="3º andar" />
            </div>
            <div>
              <label className="label">Capacidade</label>
              <input name="capacity" type="number" min={1} required className="input" placeholder="6" />
            </div>
          </div>
          <div>
            <label className="label">Recursos (separados por vírgula)</label>
            <input name="resources" className="input" placeholder="TV, Webcam, Quadro branco" />
          </div>
          <div>
            <label className="label">Cor</label>
            <input name="color" type="color" defaultValue="var(--mh-primary-500)" className="input" style={{ height: 42, padding: 4 }} />
          </div>
        </FormModal>
      )}
    >
      {rooms && rooms.length > 0 ? (
        <table className="table">
          <thead>
            <tr><th>Sala</th><th>Localização</th><th>Capacidade</th><th>Recursos</th><th>Status</th>{canEdit && <th style={{ textAlign: "right" }}>Ações</th>}</tr>
          </thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id}>
                <td>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", fontWeight: 600 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: r.color }} />
                    {r.name}
                  </span>
                </td>
                <td className="muted">{r.location ?? "—"}</td>
                <td className="muted">{r.capacity} pessoas</td>
                <td>
                  {(r.resources ?? []).length > 0 ? (
                    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "0.3rem" }}>
                      {(r.resources ?? []).map((res: string) => <Badge key={res} tone="gray">{res}</Badge>)}
                    </span>
                  ) : <span className="soft">—</span>}
                </td>
                <td><Badge tone={r.is_active ? "green" : "gray"}>{r.is_active ? "Ativa" : "Inativa"}</Badge></td>
                {canEdit && (
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <span style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center", justifyContent: "flex-end" }}>
                    <FormModal
                      triggerLabel={<Pencil size={16} />}
                      triggerClassName="icon-btn"
                      triggerTitle="Editar"
                      title={`Editar sala · ${r.name}`}
                      action={updateRoom}
                      submitLabel="Salvar"
                    >
                      <input type="hidden" name="id" value={r.id} />
                      <div>
                        <label className="label">Nome</label>
                        <input name="name" className="input" required defaultValue={r.name} placeholder="Sala Principal" />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: "0.8rem" }}>
                        <div>
                          <label className="label">Localização</label>
                          <input name="location" className="input" defaultValue={r.location ?? ""} placeholder="3º andar" />
                        </div>
                        <div>
                          <label className="label">Capacidade</label>
                          <input name="capacity" type="number" min={1} required defaultValue={r.capacity} className="input" />
                        </div>
                      </div>
                      <div>
                        <label className="label">Recursos (separados por vírgula)</label>
                        <input name="resources" className="input" defaultValue={(r.resources ?? []).join(", ")} placeholder="TV, Webcam, Quadro branco" />
                      </div>
                      <div>
                        <label className="label">Cor</label>
                        <input name="color" type="color" defaultValue={r.color ?? "#2563eb"} className="input" style={{ height: 42, padding: 4 }} />
                      </div>
                    </FormModal>
                    <form action={toggleRoom} style={{ display: "inline-flex" }}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="is_active" value={String(r.is_active)} />
                      <button className="icon-btn" type="submit" title={r.is_active ? "Desativar" : "Ativar"} aria-label={r.is_active ? "Desativar" : "Ativar"}>
                        {r.is_active ? <Power size={16} /> : <RotateCcw size={16} />}
                      </button>
                    </form>
                    <ConfirmActionButton
                      action={deleteRoom}
                      fields={{ id: r.id }}
                      className="icon-btn icon-btn-danger"
                      buttonTitle="Excluir"
                      title="Excluir sala"
                      message={<>Excluir a sala <strong>{r.name}</strong>? Esta ação não pode ser desfeita.</>}
                    >
                      <Trash2 size={16} />
                    </ConfirmActionButton>
                  </span>
                </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState title="Nenhuma sala cadastrada" description={canEdit ? "Crie a primeira sala para começar a agendar reuniões." : undefined} />
      )}
    </Section>
    </div>
  );

  const feriadosTab = (
    <div style={{ maxWidth: 760 }}>
    <Section
      title={`Feriados · ${holidays?.length ?? 0}`}
      padded={false}
      action={
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {seEdita(<ImportHolidaysDialog />)}
          <ExportButton filename="feriados.xlsx" sheetName="Feriados" headers={["Data", "Nome"]} rows={(holidays ?? []).map((h) => { const [y, m, d] = h.day.split("-"); return [`${d}/${m}/${y}`, h.name]; })} />
          {seEdita(
            <FormModal triggerLabel="+ Novo feriado" title="Novo feriado" action={createHoliday} submitLabel="Adicionar">
              <div>
                <label className="label">Data</label>
                <input name="day" type="date" className="input" required />
              </div>
              <div>
                <label className="label">Nome</label>
                <input name="name" className="input" required placeholder="Ex.: Aniversário da cidade" />
              </div>
            </FormModal>
          )}
        </div>
      }
    >
      <div className="muted" style={{ fontSize: "0.82rem", padding: "0.9rem 1.25rem 0", margin: "0 0 0.8rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        <p style={{ margin: 0 }}>
          Os feriados <strong>nacionais</strong> (fixos e móveis) já são reconhecidos automaticamente e sinalizados no
          calendário de salas. Cadastre aqui apenas feriados <strong>próprios</strong> (estaduais, municipais ou pontos
          facultativos da empresa).
        </p>
        <p style={{ margin: 0 }}>
          <strong>Domingo</strong> é considerado dia não útil; <strong>sábado</strong> é útil (a não ser que você o
          cadastre como feriado acima). Ao agendar manualmente num dia não útil, o sistema avisa, mas não impede. Já as
          reuniões <strong>recorrentes</strong> que caírem em domingo ou feriado são <strong>deslocadas para o próximo dia
          útil</strong>.
        </p>
      </div>
      {holidays && holidays.length > 0 ? (
        <table className="table">
          <thead>
            <tr><th>Data</th><th>Feriado</th>{canEdit && <th style={{ textAlign: "right" }}>Ações</th>}</tr>
          </thead>
          <tbody>
            {holidays.map((h) => (
              <tr key={h.id}>
                <td className="muted">{formatDate(h.day)}</td>
                <td style={{ fontWeight: 600 }}>{h.name}</td>
                {canEdit && (
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <ConfirmActionButton
                    action={deleteHoliday}
                    fields={{ id: h.id }}
                    className="icon-btn icon-btn-danger"
                    buttonTitle="Excluir"
                    title="Excluir feriado"
                    message={<>Excluir o feriado <strong>{h.name}</strong>? Esta ação não pode ser desfeita.</>}
                  >
                    <Trash2 size={16} />
                  </ConfirmActionButton>
                </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState title="Nenhum feriado próprio cadastrado" description="Os feriados nacionais já são automáticos. Adicione aqui apenas feriados locais da empresa." />
      )}
    </Section>
    </div>
  );

  // ---------- SDPO / Programa de Excelência ----------
  // Hierarquia: Programa → Pilar → Seção (global) → [Bloco opcional] → Item
  const withCode = (code: string | null, name: string) => (code ? `${code} - ${name}` : name);
  const programaOpts = (programas ?? []).map((p) => ({ id: p.id, name: p.name, active: p.active }));
  const pilarOpts = (pilares ?? []).map((p) => ({ id: p.id, name: p.name, active: p.active }));
  const secaoOpts = (secoes ?? []).map((s) => ({ id: s.id, name: s.name, active: s.active }));
  const blocoOpts = (blocos ?? []).map((b) => ({ id: b.id, name: b.name, code: b.code, programa_id: b.programa_id, pilar_id: b.pilar_id, secao_id: b.secao_id, active: b.active }));
  const itemOpts = (itens ?? []).map((i) => ({ id: i.id, name: i.name, code: i.code, programa_id: i.programa_id, pilar_id: i.pilar_id, secao_id: i.secao_id, bloco_id: i.bloco_id, active: i.active }));
  const programaById = new Map(programaOpts.map((p) => [p.id, p.name]));
  const pilarById = new Map(pilarOpts.map((p) => [p.id, p.name]));
  const secaoById = new Map(secaoOpts.map((s) => [s.id, s.name]));
  const blocoById = new Map(blocoOpts.map((b) => [b.id, withCode(b.code, b.name)]));
  // programa é o topo (SPO/DPO); pilar e seção são globais
  const progPilarSecao = (programaId: string | null, pilarId: string, secaoId: string) =>
    `${(programaId ? programaById.get(programaId) : null) ?? "—"} › ${pilarById.get(pilarId) ?? "—"} › ${secaoById.get(secaoId) ?? "—"}`;

  // ordenação natural do código do item ("1", "1.0", "2", "12" → 1, 1.0, 2, 12); sem código vai por último
  const cmpCode = (a: string | null, b: string | null) => {
    const pa = (a ?? "").match(/\d+/g)?.map(Number) ?? [];
    const pb = (b ?? "").match(/\d+/g)?.map(Number) ?? [];
    if (pa.length === 0 && pb.length > 0) return 1;
    if (pb.length === 0 && pa.length > 0) return -1;
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) { const x = pa[i] ?? -1, y = pb[i] ?? -1; if (x !== y) return x - y; }
    return 0;
  };
  // itens ordenados por pilar e, dentro do pilar, pelo número do item
  itemOpts.sort((a, b) => {
    const pa = pilarById.get(a.pilar_id) ?? "", pb = pilarById.get(b.pilar_id) ?? "";
    if (pa !== pb) return pa.localeCompare(pb, "pt-BR");
    const c = cmpCode(a.code, b.code);
    return c !== 0 ? c : a.name.localeCompare(b.name, "pt-BR");
  });
  // blocos ordenados por pilar e, dentro do pilar, pelo número do bloco
  blocoOpts.sort((a, b) => {
    const pa = pilarById.get(a.pilar_id) ?? "", pb = pilarById.get(b.pilar_id) ?? "";
    if (pa !== pb) return pa.localeCompare(pb, "pt-BR");
    const c = cmpCode(a.code, b.code);
    return c !== 0 ? c : a.name.localeCompare(b.name, "pt-BR");
  });

  // exportação da estrutura do Programa de Excelência (mesmas colunas do modelo de importação)
  const SDPO_EXPORT_HEADERS = ["Programa", "Pilar", "Seção", "Código Bloco", "Bloco", "Código Item", "Item"];
  const blocoCodeById = new Map(blocoOpts.map((b) => [b.id, b.code]));
  const blocoNameById = new Map(blocoOpts.map((b) => [b.id, b.name]));
  const progNameById = (id: string | null) => (id ? programaById.get(id) ?? "" : "");
  const blocosComItens = new Set(itemOpts.map((i) => i.bloco_id).filter((x): x is string => !!x));
  const sdpoExportRows: (string | number | null)[][] = [
    ...itemOpts.map((i) => [progNameById(i.programa_id), pilarById.get(i.pilar_id) ?? "", secaoById.get(i.secao_id) ?? "", i.bloco_id ? (blocoCodeById.get(i.bloco_id) ?? "") : "", i.bloco_id ? (blocoNameById.get(i.bloco_id) ?? "") : "", i.code ?? "", i.name]),
    ...blocoOpts.filter((b) => !blocosComItens.has(b.id)).map((b) => [progNameById(b.programa_id), pilarById.get(b.pilar_id) ?? "", secaoById.get(b.secao_id) ?? "", b.code ?? "", b.name, "", ""]),
  ];

  // um programa só pode ser excluído se não tiver blocos/itens vinculados (senão: desativar)
  const programaUsed = new Set<string>();
  for (const b of blocoOpts) if (b.programa_id) programaUsed.add(b.programa_id);
  for (const i of itemOpts) if (i.programa_id) programaUsed.add(i.programa_id);
  const canDeletePrograma = (id: string) => !programaUsed.has(id);

  // pode excluir só se nada da subárvore já foi usado em ações (senão: desativar)
  const itensByBloco = new Map<string, string[]>();
  const itensBySecao = new Map<string, string[]>();
  const itensByPilar = new Map<string, string[]>();
  for (const i of itemOpts) {
    if (i.bloco_id) { const a = itensByBloco.get(i.bloco_id) ?? []; a.push(i.id); itensByBloco.set(i.bloco_id, a); }
    const s = itensBySecao.get(i.secao_id) ?? []; s.push(i.id); itensBySecao.set(i.secao_id, s);
    const p = itensByPilar.get(i.pilar_id) ?? []; p.push(i.id); itensByPilar.set(i.pilar_id, p);
  }
  const blocosBySecao = new Map<string, string[]>();
  const blocosByPilar = new Map<string, string[]>();
  for (const b of blocoOpts) {
    const a = blocosBySecao.get(b.secao_id) ?? []; a.push(b.id); blocosBySecao.set(b.secao_id, a);
    const p = blocosByPilar.get(b.pilar_id) ?? []; p.push(b.id); blocosByPilar.set(b.pilar_id, p);
  }
  const blocoUsedDeep = (bId: string) => usedBloco.has(bId) || (itensByBloco.get(bId) ?? []).some((id) => usedItem.has(id));
  const secaoUsedDeep = (sId: string) => usedSecao.has(sId) || (blocosBySecao.get(sId) ?? []).some(blocoUsedDeep) || (itensBySecao.get(sId) ?? []).some((id) => usedItem.has(id));
  const canDeletePilar = (pId: string) =>
    !usedPilar.has(pId) &&
    !(blocosByPilar.get(pId) ?? []).some(blocoUsedDeep) &&
    !(itensByPilar.get(pId) ?? []).some((id) => usedItem.has(id));

  // selects (forms server-rendered, sem cascata JS)
  const programaOptions = programaOpts.filter((pr) => pr.active).map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>);
  const pilarOptions = pilarOpts.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>);
  const secaoOptions = secaoOpts.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>);
  // blocos para o form de itens: agrupados por pilar, rotulando a seção
  const blocoOptGroups = pilarOpts.filter((p) => p.active).map((pi) => (
    <optgroup key={pi.id} label={pi.name}>
      {blocoOpts.filter((b) => b.active && b.pilar_id === pi.id).map((b) => <option key={b.id} value={b.id}>{(secaoById.get(b.secao_id) ?? "—") + " · " + withCode(b.code, b.name)}</option>)}
    </optgroup>
  ));

  const sdpoTab = (
    <Tabs
      variant="sub"
      tabs={[
        {
          id: "programas",
          label: "Programas",
          content: (
            <RegistryList
              canEdit={canEdit}
              title="Programas"
              items={programaOpts.map((p) => ({ id: p.id, name: p.name, active: p.active, canDelete: canDeletePrograma(p.id) }))}
              createAction={createProgram}
              deleteAction={deleteProgram}
              toggleAction={setProgramActive}
              placeholder="Ex.: SPO, DPO"
            />
          ),
        },
        {
          id: "pilares",
          label: "Pilares",
          content: (
            <RegistryList
              canEdit={canEdit}
              title="Pilares"
              items={pilarOpts.map((p) => ({ id: p.id, name: p.name, active: p.active, canDelete: canDeletePilar(p.id) }))}
              createAction={createPilar}
              deleteAction={deletePilar}
              toggleAction={setPilarActive}
              placeholder="Nome do pilar"
              emptyText="Nenhum pilar cadastrado."
              headerAction={<>{seEdita(<ImportSdpoDialog />)}<ExportButton filename="programa_excelencia.xlsx" sheetName="Estrutura" headers={SDPO_EXPORT_HEADERS} rows={sdpoExportRows} /></>}
            />
          ),
        },
        {
          id: "secoes",
          label: "Seções",
          content: (
            <RegistryList
              canEdit={canEdit}
              title="Seções"
              items={secaoOpts.map((s) => ({ id: s.id, name: s.name, active: s.active, canDelete: !secaoUsedDeep(s.id) }))}
              createAction={createSecao}
              deleteAction={deleteSecao}
              toggleAction={setSecaoActive}
              placeholder="Ex.: Gestão de Processos"
              emptyText="Nenhuma seção cadastrada."
              headerAction={<>{seEdita(<ImportSdpoDialog />)}<ExportButton filename="programa_excelencia.xlsx" sheetName="Estrutura" headers={SDPO_EXPORT_HEADERS} rows={sdpoExportRows} /></>}
            />
          ),
        },
        {
          id: "blocos",
          label: "Blocos",
          content: (
            <RegistryList
              canEdit={canEdit}
              title="Blocos"
              items={blocoOpts.map((b) => ({ id: b.id, name: withCode(b.code, b.name), meta: progPilarSecao(b.programa_id, b.pilar_id, b.secao_id), active: b.active, canDelete: !blocoUsedDeep(b.id) }))}
              createAction={createBloco}
              deleteAction={deleteBloco}
              toggleAction={setBlocoActive}
              placeholder="Nome do bloco"
              metaLabel="Programa / Pilar / Seção"
              emptyText="Nenhum bloco. Cadastre programas, pilares e seções primeiro."
              headerAction={<>{seEdita(<ImportSdpoDialog />)}<ExportButton filename="programa_excelencia.xlsx" sheetName="Estrutura" headers={SDPO_EXPORT_HEADERS} rows={sdpoExportRows} /></>}
              extraFields={
                <>
                  <input name="code" className="input" placeholder="Código (ex.: 1.0)" style={{ width: 130 }} />
                  <select name="programa_id" className="select" required style={{ width: "auto" }}>
                    <option value="">Programa…</option>
                    {programaOptions}
                  </select>
                  <select name="pilar_id" className="select" required style={{ width: "auto" }}>
                    <option value="">Pilar…</option>
                    {pilarOptions}
                  </select>
                  <select name="secao_id" className="select" required style={{ width: "auto" }}>
                    <option value="">Seção…</option>
                    {secaoOptions}
                  </select>
                </>
              }
            />
          ),
        },
        {
          id: "itens",
          label: "Itens",
          content: (
            <RegistryList
              canEdit={canEdit}
              title="Itens"
              items={itemOpts.map((i) => ({ id: i.id, name: withCode(i.code, i.name), meta: progPilarSecao(i.programa_id, i.pilar_id, i.secao_id) + (i.bloco_id ? ` › ${blocoById.get(i.bloco_id) ?? ""}` : ""), active: i.active, canDelete: !usedItem.has(i.id) }))}
              createAction={createItem}
              deleteAction={deleteItem}
              toggleAction={setItemActive}
              placeholder="Nome do item"
              metaLabel="Programa / Pilar / Seção"
              emptyText="Nenhum item. Cadastre programas, pilares e seções primeiro."
              headerAction={<>{seEdita(<ImportSdpoDialog />)}<ExportButton filename="programa_excelencia.xlsx" sheetName="Estrutura" headers={SDPO_EXPORT_HEADERS} rows={sdpoExportRows} /></>}
              extraFields={
                <>
                  <input name="code" className="input" placeholder="Código (ex.: 1.1)" style={{ width: 130 }} />
                  <select name="programa_id" className="select" required style={{ width: "auto" }}>
                    <option value="">Programa…</option>
                    {programaOptions}
                  </select>
                  <select name="pilar_id" className="select" required style={{ width: "auto" }}>
                    <option value="">Pilar…</option>
                    {pilarOptions}
                  </select>
                  <select name="secao_id" className="select" required style={{ width: "auto" }}>
                    <option value="">Seção…</option>
                    {secaoOptions}
                  </select>
                  <select name="bloco_id" className="select" style={{ width: "auto" }}>
                    <option value="">Bloco (opcional)…</option>
                    {blocoOptGroups}
                  </select>
                </>
              }
            />
          ),
        },
        {
          id: "kpis",
          label: "KPIs",
          content: <RegistryList canEdit={canEdit} title="KPIs" items={(kpis ?? []).map((k) => ({ id: k.id, name: k.name, active: k.active, canDelete: !usedKpi.has(k.id) }))} createAction={createKpi} deleteAction={deleteKpi} toggleAction={setKpiActive} placeholder="Nome do KPI" headerAction={<>{seEdita(<ImportListDialog title="Importar KPIs (.xlsx)" column="KPI" noun="KPI(s)" findKeys={["kpi", "indicador"]} examples={["OTIF", "% Lojas Ideais", "Cobertura da carteira"]} templateFile="modelo_kpis.xlsx" action={importKpis} />)}<ExportButton filename="kpis.xlsx" sheetName="KPIs" headers={["KPI"]} rows={(kpis ?? []).map((k) => [k.name])} /></>} />,
        },
        {
          id: "ferramentas",
          label: "Ferramentas de gestão",
          content: <RegistryList canEdit={canEdit} title="Ferramentas de gestão" items={(tools ?? []).map((t) => ({ id: t.id, name: t.name, active: t.active, canDelete: !usedTool.has(t.id) }))} createAction={createTool} deleteAction={deleteTool} toggleAction={setToolActive} placeholder="Ex.: 5W2H, PDCA, Ishikawa" headerAction={<>{seEdita(<ImportListDialog title="Importar Ferramentas de gestão (.xlsx)" column="Ferramenta" noun="ferramenta(s)" findKeys={["ferramenta"]} examples={["PDCA", "5W2H", "Ishikawa"]} templateFile="modelo_ferramentas.xlsx" action={importTools} />)}<ExportButton filename="ferramentas_gestao.xlsx" sheetName="Ferramentas" headers={["Ferramenta"]} rows={(tools ?? []).map((t) => [t.name])} /></>} />,
        },
      ]}
    />
  );

  // ---------- Chamados (Setores, Categorias, SLA) ----------
  const ticketSectorOpts = (ticketSectors ?? []).map((s) => ({ id: s.id, name: s.name, active: s.active }));
  const ticketSectorById = new Map(ticketSectorOpts.map((s) => [s.id, s.name]));
  const ticketCategoryOpts = (ticketCategories ?? []).map((c) => ({ id: c.id, name: c.name, sector_id: c.sector_id, active: c.active }));
  // um setor só pode ser excluído se ele e nenhuma de suas categorias foram usados em chamados
  const catsBySector = new Map<string, string[]>();
  for (const c of ticketCategoryOpts) { const a = catsBySector.get(c.sector_id) ?? []; a.push(c.id); catsBySector.set(c.sector_id, a); }
  const canDeleteSector = (id: string) => !usedSector.has(id) && !(catsBySector.get(id) ?? []).some((cid) => usedCategory.has(cid));
  // exportação de Setores+Categorias e de SLA (mesmas colunas dos modelos de importação)
  const ticketStructRows: (string | number | null)[][] = [
    ...ticketCategoryOpts.map((c) => [ticketSectorById.get(c.sector_id) ?? "", c.name]),
    ...ticketSectorOpts.filter((s) => !(catsBySector.get(s.id) ?? []).length).map((s) => [s.name, ""]),
  ];
  const ticketCatById = new Map(ticketCategoryOpts.map((c) => [c.id, c]));
  const ticketSlaRows: (string | number | null)[][] = (ticketSlas ?? []).map((s) => {
    const cat = ticketCatById.get(s.category_id);
    return [
      cat ? (ticketSectorById.get(cat.sector_id) ?? "") : "",
      cat?.name ?? "",
      s.priority ? (PRIORITY[s.priority] ?? "") : "",
      s.sla_value,
      TICKET_SLA_UNIT[s.sla_unit] ?? "",
    ];
  });
  const { data: mgrSectors } = await supabase.from("ticket_manager_sectors").select("user_id, sector_id").eq("tenant_id", tenant.id);
  const sectorsByManager = new Map<string, string[]>();
  for (const r of mgrSectors ?? []) { const a = sectorsByManager.get(r.user_id) ?? []; a.push(r.sector_id); sectorsByManager.set(r.user_id, a); }
  const ticketManagers = mems
    .filter((m) => m.is_active)
    .map((m) => ({
      userId: m.user_id,
      name: profById.get(m.user_id)?.full_name ?? profById.get(m.user_id)?.email ?? "—",
      sectorIds: sectorsByManager.get(m.user_id) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const chamadosTab = (
    <Tabs
      variant="sub"
      tabs={[
        {
          id: "ticket-setores",
          label: "Setores",
          content: (
            <RegistryList
              canEdit={canEdit}
              title="Setores de chamado"
              description="Áreas que atendem chamados (ex.: TI, Serviços Gerais)."
              items={ticketSectorOpts.map((s) => ({ ...s, canDelete: canDeleteSector(s.id) }))}
              createAction={createTicketSector}
              deleteAction={deleteTicketSector}
              toggleAction={setTicketSectorActive}
              placeholder="Nome do setor"
              headerAction={<>{seEdita(<ImportTicketStructureDialog />)}<ExportButton filename="chamados_setores_categorias.xlsx" sheetName="Estrutura" headers={["Setor", "Categoria"]} rows={ticketStructRows} /></>}
            />
          ),
        },
        {
          id: "ticket-categorias",
          label: "Categorias",
          content: (
            <RegistryList
              canEdit={canEdit}
              title="Categorias de chamado"
              description="Cada categoria pertence a um setor (ex.: TI → Acesso, Backup, Computador)."
              items={ticketCategoryOpts.map((c) => ({ id: c.id, name: c.name, meta: ticketSectorById.get(c.sector_id) ?? undefined, active: c.active, canDelete: !usedCategory.has(c.id) }))}
              createAction={createTicketCategory}
              deleteAction={deleteTicketCategory}
              toggleAction={setTicketCategoryActive}
              placeholder="Nome da categoria"
              metaLabel="Setor"
              emptyText="Nenhuma categoria. Cadastre setores primeiro."
              headerAction={<>{seEdita(<ImportTicketStructureDialog />)}<ExportButton filename="chamados_setores_categorias.xlsx" sheetName="Estrutura" headers={["Setor", "Categoria"]} rows={ticketStructRows} /></>}
              extraFields={
                <select name="sector_id" className="select" required style={{ width: "auto" }}>
                  <option value="">Setor…</option>
                  {ticketSectorOpts.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              }
            />
          ),
        },
        {
          id: "ticket-sla",
          label: "SLA",
          content: (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", maxWidth: 760 }}>
                {seEdita(<ImportTicketSlaDialog />)}
                <ExportButton filename="chamados_sla.xlsx" sheetName="SLA" headers={["Setor", "Categoria", "Prioridade", "Valor", "Unidade"]} rows={ticketSlaRows} />
              </div>
              <TicketSlaEditor
                mode={tenant.ticket_sla_mode === "category" ? "category" : "priority"}
                categories={ticketCategoryOpts.map((c) => ({ id: c.id, name: c.name, sectorName: ticketSectorById.get(c.sector_id) ?? "—" }))}
                slas={(ticketSlas ?? []).map((s) => ({ category_id: s.category_id, priority: s.priority, sla_value: s.sla_value, sla_unit: s.sla_unit }))}
                canEdit={canEdit}
              />
            </div>
          ),
        },
        {
          id: "ticket-gestores",
          label: "Gestores",
          content: <TicketManagersEditor members={ticketManagers} sectors={ticketSectorOpts.map((s) => ({ id: s.id, name: s.name }))} canEdit={canEdit} />,
        },
      ]}
    />
  );

  const tabs: Tab[] = [
    { id: "empresa", label: "Empresa", content: empresaTab },
    { id: "estrutura", label: "Estrutura", content: estruturaTab },
    { id: "usuarios", label: "Colaboradores", content: usuariosTab },
    { id: "sdpo", label: "Programa de Excelência", content: sdpoTab },
    { id: "chamados", label: "Chamados", content: chamadosTab },
    {
      id: "rv",
      label: "Remuneração variável",
      content: (
        <Tabs
          variant="sub"
          tabs={[
            { id: "rv-valores", label: "Valores", content: <RvConfigEditor positions={posOpts} members={rvMembers} configs={rvConfigs} canEdit={canEdit} /> },
            { id: "rv-redutores", label: "Redutores", content: <RvReducerEditor regras={reducerRules} tiposPunicao={sanctionTypeOpts.filter((t) => t.active)} canEdit={canEdit} /> },
            {
              id: "rv-punicoes",
              label: "Tipos de punição",
              content: (
                <RegistryList
                  canEdit={canEdit}
                  title="Tipos de punição"
                  description="As sanções previstas nas regras da empresa. O quanto cada uma reduz da RV fica na sub-aba Redutores."
                  items={sanctionTypeOpts.map((t) => ({ id: t.id, name: t.name, active: t.active, canDelete: !sanctionRows.some((s2) => s2.typeId === t.id) }))}
                  createAction={createSanctionType}
                  deleteAction={deleteSanctionType}
                  toggleAction={setSanctionTypeActive}
                  placeholder="Ex.: Advertência escrita"
                />
              ),
            },
          ]}
        />
      ),
    },
    {
      id: "feedbacks",
      label: "Feedbacks",
      content: (
        <div>
          <FeedbackCadenceEditor
            departments={deptOpts}
            positions={posOpts}
            rules={(fbCadenceRules ?? []).map((r) => ({ id: r.id, departmentId: r.department_id, positionId: r.position_id, cadenceDays: r.cadence_days }))}
            canEdit={canEdit}
          />
          <RegistryList
              canEdit={canEdit}
            title="Competências / valores"
            description="Competências marcáveis nos feedbacks. Desative as que saíram de uso. O histórico será mantido."
            items={(fbCompsData ?? []).map((c) => ({ id: c.id, name: c.name, active: c.active, canDelete: !usedCompetency.has(c.id) }))}
            createAction={addFeedbackCompetencyForm}
            deleteAction={removeFeedbackCompetencyForm}
            toggleAction={toggleFeedbackCompetencyForm}
            placeholder="Ex.: Comunicação, Foco no cliente, Colaboração"
          />
        </div>
      ),
    },
    { id: "salas", label: "Salas", content: salasTab },
    { id: "feriados", label: "Calendário e Feriados", content: feriadosTab },
  ];

  return (
    <div>
      <PageHeader title="Configurações" subtitle="Empresa, usuários, unidades e estrutura organizacional." />
      {/* Sem este aviso, a tela em consulta parece a tela normal com defeito:
          a pessoa procura o botão de adicionar, não acha, e conclui que quebrou. */}
      {!canEdit && (
        <div
          className="card"
          style={{
            display: "flex", alignItems: "center", gap: "0.55rem",
            padding: "0.7rem 0.95rem", marginBottom: "1.1rem",
            fontSize: "0.85rem", borderLeft: "3px solid var(--mh-primary-500)",
          }}
        >
          <Eye size={16} style={{ color: "var(--mh-primary-500)", flexShrink: 0 }} />
          <span>
            <strong>Somente leitura.</strong>{" "}
            <span className="muted">
              Você enxerga toda a configuração da empresa, mas alterações são feitas pelo proprietário ou por um administrador.
            </span>
          </span>
        </div>
      )}
      <Tabs tabs={tabs} />
    </div>
  );
}
