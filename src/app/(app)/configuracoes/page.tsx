import { requireContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormModal } from "@/components/ui/FormModal";
import { CompanyForm } from "@/components/CompanyForm";
import { OpenAISettingsForm } from "@/components/OpenAISettingsForm";
import { ResendSettingsForm } from "@/components/ResendSettingsForm";
import { RegistryList } from "@/components/RegistryList";
import { TicketSlaEditor } from "@/components/TicketSlaEditor";
import { TicketManagersEditor } from "@/components/TicketManagersEditor";
import { UnitsManager } from "@/components/UnitsManager";
import { UsersManager, type EmployeeRow } from "@/components/UsersManager";
import { createRoom, toggleRoom, deleteRoom } from "@/lib/actions/rooms";
import { createHoliday, deleteHoliday } from "@/lib/actions/holidays";
import { ImportHolidaysDialog } from "@/components/ImportHolidaysDialog";
import { formatDate } from "@/lib/format";
import {
  createDepartment, deleteDepartment,
  createSubdepartment, deleteSubdepartment, createPosition, deletePosition,
  createPositionLevel, deletePositionLevel,
} from "@/lib/actions/registry";
import {
  createPilar, deletePilar, createBloco, deleteBloco, createItem, deleteItem,
  createKpi, deleteKpi, createTool, deleteTool,
} from "@/lib/actions/sdpo";
import {
  createTicketSector, deleteTicketSector,
  createTicketCategory, deleteTicketCategory,
} from "@/lib/actions/tickets";

export default async function SettingsPage() {
  const { tenant, role, user } = await requireContext();
  const canAdmin = role === "owner" || role === "admin";

  if (!canAdmin) {
    return (
      <div>
        <PageHeader title="Configurações" />
        <EmptyState title="Acesso restrito" description="Apenas proprietários e administradores podem acessar as configurações." />
      </div>
    );
  }

  const supabase = await createClient();
  const [
    { data: memberships }, { data: units }, { data: departments },
    { data: subdepartments }, { data: positions }, { data: levels }, { data: rooms }, { data: holidays },
  ] = await Promise.all([
    supabase.from("memberships").select("*").eq("tenant_id", tenant.id),
    supabase.from("units").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("departments").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("subdepartments").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("positions").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("position_levels").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("rooms").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("holidays").select("*").eq("tenant_id", tenant.id).order("day"),
  ]);

  const [{ data: pilares }, { data: blocos }, { data: itens }, { data: kpis }, { data: tools }] = await Promise.all([
    supabase.from("sdpo_pilares").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("sdpo_blocos").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("sdpo_itens").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("action_kpis").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("action_tools").select("*").eq("tenant_id", tenant.id).order("name"),
  ]);

  const [{ data: ticketSectors }, { data: ticketCategories }, { data: ticketSlas }] = await Promise.all([
    supabase.from("ticket_sectors").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("ticket_categories").select("*").eq("tenant_id", tenant.id).order("name"),
    supabase.from("ticket_slas").select("*").eq("tenant_id", tenant.id),
  ]);

  const mems = memberships ?? [];

  // RLS já limita ao tenant — evita .in() com centenas de ids (estoura a URL do PostgREST)
  const [{ data: profilesData }, { data: muData }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, cpf, phone, birth_date, gender").limit(5000),
    supabase.from("membership_units").select("membership_id, unit_id").limit(20000),
  ]);

  // mapas de apoio
  const profById = new Map((profilesData ?? []).map((p) => [p.id, p]));
  const unitById = new Map((units ?? []).map((u) => [u.id, u]));
  const deptById = new Map((departments ?? []).map((d) => [d.id, d]));
  const posById = new Map((positions ?? []).map((p) => [p.id, p]));
  const levelById = new Map((levels ?? []).map((l) => [l.id, l]));
  const unitsByMem = new Map<string, string[]>();
  for (const mu of muData ?? []) {
    const arr = unitsByMem.get(mu.membership_id) ?? [];
    arr.push(mu.unit_id);
    unitsByMem.set(mu.membership_id, arr);
  }

  const employees: EmployeeRow[] = mems.map((m) => {
    const p = profById.get(m.user_id);
    const uIds = unitsByMem.get(m.id) ?? [];
    return {
      userId: m.user_id,
      fullName: p?.full_name ?? null,
      email: p?.email ?? null,
      cpf: p?.cpf ?? null,
      phone: p?.phone ?? null,
      birthDate: p?.birth_date ?? null,
      gender: p?.gender ?? null,
      role: m.role,
      employeeCode: m.employee_code,
      admissionDate: m.admission_date,
      departmentId: m.department_id,
      subdepartmentId: m.subdepartment_id,
      positionId: m.position_id,
      positionLevelId: m.position_level_id,
      managerId: m.manager_id,
      unitIds: uIds,
      departmentName: m.department_id ? deptById.get(m.department_id)?.name ?? null : null,
      positionName: m.position_id ? posById.get(m.position_id)?.name ?? null : null,
      levelName: m.position_level_id ? levelById.get(m.position_level_id)?.name ?? null : null,
      managerName: m.manager_id ? profById.get(m.manager_id)?.full_name ?? null : null,
      unitNames: uIds.map((id) => unitById.get(id)?.name).filter((x): x is string => !!x),
      active: m.is_active,
    };
  });

  const people = (profilesData ?? []).map((p) => ({ id: p.id, name: p.full_name ?? p.email ?? "—" }));
  const unitOpts = (units ?? []).map((u) => ({ id: u.id, name: u.name, kind: u.kind }));
  const deptOpts = (departments ?? []).map((d) => ({ id: d.id, name: d.name }));
  const subOpts = (subdepartments ?? []).map((s) => ({ id: s.id, name: s.name, department_id: s.department_id }));
  const posOpts = (positions ?? []).map((p) => ({ id: p.id, name: p.name }));
  const levelOpts = (levels ?? []).map((l) => ({ id: l.id, name: l.name }));

  // ---------- Conteúdo das abas ----------
  const empresaTab = (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 760 }}>
      <Section title="Dados da empresa">
        <CompanyForm name={tenant.name} canEdit={role === "owner"} />
      </Section>
      <UnitsManager
        units={(units ?? []).map((u) => ({ id: u.id, name: u.name, kind: u.kind, cnpj: u.cnpj }))}
        unitLimit={tenant.units_limit}
      />
    </div>
  );

  const integracoesTab = (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 760 }}>
      <Section title="Integração com IA (OpenAI)">
        <OpenAISettingsForm hasKey={tenant.has_openai_key} model={tenant.openai_model} canEdit={role === "owner"} />
      </Section>
      <Section title="Envio de e-mail / Convites (Resend)">
        <ResendSettingsForm hasKey={tenant.has_resend_key} canEdit={role === "owner"} />
      </Section>
    </div>
  );

  const usuariosTab = (
    <UsersManager
      employees={employees}
      units={unitOpts}
      departments={deptOpts}
      subdepartments={subOpts}
      positions={posOpts}
      levels={levelOpts}
      people={people}
      currentUserId={user.id}
    />
  );

  const estruturaTab = (
    <Tabs
      variant="sub"
      tabs={[
        {
          id: "setores",
          label: "Setores",
          content: <RegistryList title="Setores" items={deptOpts} createAction={createDepartment} deleteAction={deleteDepartment} placeholder="Nome do setor" />,
        },
        {
          id: "subsetores",
          label: "Subsetores",
          content: (
            <RegistryList
              title="Subsetores"
              description="Cada subsetor pertence a um setor."
              items={subOpts.map((s) => ({ id: s.id, name: s.name, meta: deptById.get(s.department_id)?.name ?? undefined }))}
              createAction={createSubdepartment}
              deleteAction={deleteSubdepartment}
              placeholder="Nome do subsetor"
              metaLabel="Setor"
              emptyText="Nenhum subsetor. Cadastre setores primeiro."
              extraFields={
                <select name="department_id" className="select" required style={{ width: "auto" }}>
                  <option value="">Setor…</option>
                  {deptOpts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              }
            />
          ),
        },
        {
          id: "funcoes",
          label: "Funções",
          content: <RegistryList title="Funções" items={posOpts} createAction={createPosition} deleteAction={deletePosition} placeholder="Nome da função" />,
        },
        {
          id: "perfis",
          label: "Perfis de função",
          content: <RegistryList title="Perfis de função" description="Ex.: Júnior, Pleno, Sênior." items={levelOpts} createAction={createPositionLevel} deleteAction={deletePositionLevel} placeholder="Ex.: Júnior, Pleno, Sênior" />,
        },
      ]}
    />
  );

  const salasTab = (
    <div style={{ maxWidth: 760 }}>
    <Section
      title={`Salas de reunião · ${rooms?.length ?? 0}`}
      padded={false}
      action={
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
              <input name="capacity" type="number" min={1} defaultValue={6} className="input" />
            </div>
          </div>
          <div>
            <label className="label">Recursos (separados por vírgula)</label>
            <input name="resources" className="input" placeholder="TV, Webcam, Quadro branco" />
          </div>
          <div>
            <label className="label">Cor</label>
            <input name="color" type="color" defaultValue="#4f46e5" className="input" style={{ height: 42, padding: 4 }} />
          </div>
        </FormModal>
      }
    >
      {rooms && rooms.length > 0 ? (
        <table className="table">
          <thead>
            <tr><th>Sala</th><th>Localização</th><th>Capacidade</th><th>Status</th><th style={{ textAlign: "right" }}>Ações</th></tr>
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
                <td><Badge tone={r.is_active ? "green" : "gray"}>{r.is_active ? "Ativa" : "Inativa"}</Badge></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <form action={toggleRoom} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="is_active" value={String(r.is_active)} />
                    <button className="btn btn-ghost btn-sm" type="submit">{r.is_active ? "Desativar" : "Ativar"}</button>
                  </form>{" "}
                  <form action={deleteRoom} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="btn btn-danger btn-sm" type="submit">Excluir</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState title="Nenhuma sala cadastrada" description="Crie a primeira sala para começar a agendar reuniões." />
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
          <ImportHolidaysDialog />
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
          cadastre como feriado acima). Ao agendar manualmente num dia não útil, o sistema avisa — mas não impede. Já as
          reuniões <strong>recorrentes</strong> que caírem em domingo ou feriado são <strong>deslocadas para o próximo dia
          útil</strong>.
        </p>
      </div>
      {holidays && holidays.length > 0 ? (
        <table className="table">
          <thead>
            <tr><th>Data</th><th>Feriado</th><th style={{ textAlign: "right" }}>Ações</th></tr>
          </thead>
          <tbody>
            {holidays.map((h) => (
              <tr key={h.id}>
                <td className="muted">{formatDate(h.day)}</td>
                <td style={{ fontWeight: 600 }}>{h.name}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <form action={deleteHoliday} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={h.id} />
                    <button className="btn btn-danger btn-sm" type="submit">Excluir</button>
                  </form>
                </td>
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
  const pilarOpts = (pilares ?? []).map((p) => ({ id: p.id, name: p.name }));
  const blocoOpts = (blocos ?? []).map((b) => ({ id: b.id, name: b.name, pilar_id: b.pilar_id }));
  const itemOpts = (itens ?? []).map((i) => ({ id: i.id, name: i.name, bloco_id: i.bloco_id }));
  const pilarById = new Map(pilarOpts.map((p) => [p.id, p.name]));
  const blocoById = new Map(blocoOpts.map((b) => [b.id, b.name]));

  const sdpoTab = (
    <Tabs
      variant="sub"
      tabs={[
        {
          id: "pilares",
          label: "Pilares",
          content: <RegistryList title="Pilares" description="Pilares do Programa de Excelência (SDPO)." items={pilarOpts} createAction={createPilar} deleteAction={deletePilar} placeholder="Nome do pilar" />,
        },
        {
          id: "blocos",
          label: "Blocos",
          content: (
            <RegistryList
              title="Blocos"
              description="Cada bloco pertence a um pilar."
              items={blocoOpts.map((b) => ({ id: b.id, name: b.name, meta: pilarById.get(b.pilar_id) ?? undefined }))}
              createAction={createBloco}
              deleteAction={deleteBloco}
              placeholder="Nome do bloco"
              metaLabel="Pilar"
              emptyText="Nenhum bloco. Cadastre pilares primeiro."
              extraFields={
                <select name="pilar_id" className="select" required style={{ width: "auto" }}>
                  <option value="">Pilar…</option>
                  {pilarOpts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              }
            />
          ),
        },
        {
          id: "itens",
          label: "Itens",
          content: (
            <RegistryList
              title="Itens"
              description="Cada item pertence a um bloco."
              items={itemOpts.map((i) => ({ id: i.id, name: i.name, meta: blocoById.get(i.bloco_id) ?? undefined }))}
              createAction={createItem}
              deleteAction={deleteItem}
              placeholder="Nome do item"
              metaLabel="Bloco"
              emptyText="Nenhum item. Cadastre blocos primeiro."
              extraFields={
                <select name="bloco_id" className="select" required style={{ width: "auto" }}>
                  <option value="">Bloco…</option>
                  {blocoOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              }
            />
          ),
        },
        {
          id: "kpis",
          label: "KPIs",
          content: <RegistryList title="KPIs" description="Indicadores relacionados às ações." items={(kpis ?? []).map((k) => ({ id: k.id, name: k.name }))} createAction={createKpi} deleteAction={deleteKpi} placeholder="Nome do KPI" />,
        },
        {
          id: "ferramentas",
          label: "Ferramentas de gestão",
          content: <RegistryList title="Ferramentas de gestão" items={(tools ?? []).map((t) => ({ id: t.id, name: t.name }))} createAction={createTool} deleteAction={deleteTool} placeholder="Ex.: 5W2H, PDCA, Ishikawa" />,
        },
      ]}
    />
  );

  // ---------- Chamados (Setores, Categorias, SLA) ----------
  const ticketSectorOpts = (ticketSectors ?? []).map((s) => ({ id: s.id, name: s.name }));
  const ticketSectorById = new Map(ticketSectorOpts.map((s) => [s.id, s.name]));
  const ticketCategoryOpts = (ticketCategories ?? []).map((c) => ({ id: c.id, name: c.name, sector_id: c.sector_id }));
  const ticketManagers = mems
    .filter((m) => m.is_active)
    .map((m) => ({
      userId: m.user_id,
      name: profById.get(m.user_id)?.full_name ?? profById.get(m.user_id)?.email ?? "—",
      isManager: m.is_ticket_manager,
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
              title="Setores de chamado"
              description="Áreas que atendem chamados (ex.: TI, Serviços Gerais)."
              items={ticketSectorOpts}
              createAction={createTicketSector}
              deleteAction={deleteTicketSector}
              placeholder="Nome do setor"
            />
          ),
        },
        {
          id: "ticket-categorias",
          label: "Categorias",
          content: (
            <RegistryList
              title="Categorias de chamado"
              description="Cada categoria pertence a um setor (ex.: TI → Acesso, Backup, Computador)."
              items={ticketCategoryOpts.map((c) => ({ id: c.id, name: c.name, meta: ticketSectorById.get(c.sector_id) ?? undefined }))}
              createAction={createTicketCategory}
              deleteAction={deleteTicketCategory}
              placeholder="Nome da categoria"
              metaLabel="Setor"
              emptyText="Nenhuma categoria. Cadastre setores primeiro."
              extraFields={
                <select name="sector_id" className="select" required style={{ width: "auto" }}>
                  <option value="">Setor…</option>
                  {ticketSectorOpts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              }
            />
          ),
        },
        {
          id: "ticket-sla",
          label: "SLA",
          content: (
            <TicketSlaEditor
              categories={ticketCategoryOpts.map((c) => ({ id: c.id, name: c.name, sectorName: ticketSectorById.get(c.sector_id) ?? "—" }))}
              slas={(ticketSlas ?? []).map((s) => ({ category_id: s.category_id, priority: s.priority, sla_value: s.sla_value, sla_unit: s.sla_unit }))}
            />
          ),
        },
        {
          id: "ticket-gestores",
          label: "Gestores",
          content: <TicketManagersEditor members={ticketManagers} />,
        },
      ]}
    />
  );

  const tabs: Tab[] = [
    { id: "empresa", label: "Empresa", content: empresaTab },
    { id: "estrutura", label: "Estrutura", content: estruturaTab },
    { id: "usuarios", label: "Usuários", content: usuariosTab },
    { id: "sdpo", label: "Programa de Excelência", content: sdpoTab },
    { id: "chamados", label: "Chamados", content: chamadosTab },
    { id: "salas", label: "Salas", content: salasTab },
    { id: "feriados", label: "Calendário e Feriados", content: feriadosTab },
    { id: "integracoes", label: "Integrações", content: integracoesTab },
  ];

  return (
    <div>
      <PageHeader title="Configurações" subtitle="Empresa, usuários, unidades e estrutura organizacional." />
      <Tabs tabs={tabs} />
    </div>
  );
}
