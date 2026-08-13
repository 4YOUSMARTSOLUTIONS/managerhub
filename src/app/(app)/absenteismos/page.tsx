import { requireContext, getMembers, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { minhaEquipe } from "@/lib/team";
import { moduleGate } from "@/lib/module-gate";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AbsenteismosManager, type AbsenteismoRow } from "@/components/AbsenteismosManager";

/**
 * Absenteísmos.
 *
 * O gestor registra que alguém não apareceu, sem saber o motivo, e o comunicado
 * por e-mail sai na hora. Depois, com a situação esclarecida, ele
 * confirma o que foi (falta, atestado, licença), anexa o documento e envia ao
 * RH. Só a aprovação do RH cria a linha em `employee_absences`, que é a base
 * que a remuneração variável lê.
 *
 * O dado clínico (CID, médico, local) NÃO vem nesta consulta: ele mora em
 * `absenteismo_atestados` e é lido sob demanda, um por vez, pela RPC
 * `absenteismo_atestado`. Sem isso, o diagnóstico de dezenas de pessoas viajaria
 * no payload da listagem mesmo sem a tela mostrar.
 */
export default async function AbsenteismosPage() {
  const gate = await moduleGate("absenteismos");
  if (gate) return gate;

  const { tenant, user, role, unitScope } = await requireContext();
  const ehDp = role === "owner" || role === "admin" || role === "hr";
  // Menu não é autorização: quem digitar a URL na mão para aqui.
  const podeAbrir = ehDp || role === "manager" || role === "team_lead";
  const supabase = await createClient();

  if (!podeAbrir) {
    return (
      <div>
        <PageHeader title="Absenteísmos" />
        <EmptyState
          title="Acesso restrito"
          description="O não comparecimento é lançado pelo gestor da pessoa e aprovado pelo RH. Quem não faz nem uma coisa nem outra não acompanha lançamentos por aqui."
        />
      </div>
    );
  }

  const equipe = ehDp ? [] : await minhaEquipe(supabase, tenant.id);

  if (!ehDp && equipe.length === 0) {
    return (
      <div>
        <PageHeader title="Absenteísmos" subtitle={tenant.name} />
        <EmptyState
          title="Nada para lançar por aqui"
          description="O não comparecimento é lançado pelo gestor da pessoa. Assim que houver alguém sob sua gestão, o formulário aparece nesta tela."
        />
      </div>
    );
  }

  const unidades = effectiveUnitFilter(unitScope);
  let lista = supabase
    .from("absenteismo_lancamentos")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("occurred_on", { ascending: false })
    .limit(500);
  if (unidades) lista = lista.or(`snap_unit_id.in.(${unidades.join(",")}),snap_unit_id.is.null`);

  const [
    { data: lancamentos }, membros, { data: tipos },
    { data: vinculos }, { data: deps }, { data: subs }, { data: cargos },
    { data: vinculoUnidades }, { data: unidadesTodas },
    { data: regrasRedutor }, { data: faixasRedutor },
  ] = await Promise.all([
    lista,
    getMembers(tenant.id),
    supabase
      .from("absence_types")
      .select("id, name, description, kind, requires_document, requires_medical, requires_companion, requires_kinship, discounts_rv_default, active")
      .eq("tenant_id", tenant.id)
      .order("sort").order("name"),
    supabase
      .from("memberships")
      .select("id, user_id, employee_code, department_id, subdepartment_id, position_id, manager_id")
      .eq("tenant_id", tenant.id),
    supabase.from("departments").select("id, name").eq("tenant_id", tenant.id),
    supabase.from("subdepartments").select("id, name").eq("tenant_id", tenant.id),
    supabase.from("positions").select("id, name").eq("tenant_id", tenant.id),
    supabase.from("membership_units").select("membership_id, unit_id").limit(20000),
    supabase.from("units").select("id, name").eq("tenant_id", tenant.id),
    // para a tela dizer o efeito REAL do tipo escolhido na remuneração
    // variável: um comportamento com faixa de redutor ativa corta por faixa e
    // não desconta os dias de novo na proporcionalidade
    supabase.from("rv_reducer_rules").select("id, absence_kind").eq("tenant_id", tenant.id).eq("source", "absence").eq("active", true),
    supabase.from("rv_reducer_bands").select("rule_id").eq("tenant_id", tenant.id),
  ]);

  const nomePorId = new Map<string, string>();
  for (const m of membros) {
    if (m.profile?.id) nomePorId.set(m.profile.id, m.profile.full_name ?? "");
  }

  const alcance = ehDp ? [...nomePorId.keys()] : equipe;

  const nomeDep = new Map((deps ?? []).map((d) => [d.id, d.name]));
  const nomeSub = new Map((subs ?? []).map((s) => [s.id, s.name]));
  const nomeCargo = new Map((cargos ?? []).map((c) => [c.id, c.name]));
  const nomeUnidade = new Map((unidadesTodas ?? []).map((u) => [u.id, u.name]));
  const unidadePorVinculo = new Map((vinculoUnidades ?? []).map((vu) => [vu.membership_id, vu.unit_id]));
  const vinculoPorUsuario = new Map((vinculos ?? []).map((v) => [v.user_id, v]));

  const pessoas = alcance
    .filter((id) => id !== user.id)
    .map((id) => {
      const v = vinculoPorUsuario.get(id);
      const unitId = v ? unidadePorVinculo.get(v.id) ?? null : null;
      return {
        id,
        name: nomePorId.get(id) ?? "",
        matricula: v?.employee_code ?? null,
        setor: v?.department_id ? nomeDep.get(v.department_id) ?? null : null,
        subsetor: v?.subdepartment_id ? nomeSub.get(v.subdepartment_id) ?? null : null,
        funcao: v?.position_id ? nomeCargo.get(v.position_id) ?? null : null,
        gestor: v?.manager_id ? nomePorId.get(v.manager_id) ?? null : null,
        unidade: unitId ? nomeUnidade.get(unitId) ?? null : null,
      };
    })
    .filter((p) => p.name)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const rows: AbsenteismoRow[] = (lancamentos ?? []).map((l) => ({
    id: l.id,
    status: l.status,
    userId: l.user_id,
    occurredOn: l.occurred_on,
    reasonNote: l.reason_note,
    absenceTypeId: l.absence_type_id,
    typeName: l.snap_type_name,
    kind: l.snap_kind,
    requiresDocument: l.snap_requires_document,
    requiresMedical: l.snap_requires_medical,
    startDate: l.start_date,
    endDate: l.end_date,
    discountsRv: l.discounts_rv,
    note: l.note,
    kinship: l.kinship_of_deceased,
    workAccident: l.work_accident,
    certificateKind: l.certificate_kind,
    waived: l.waived,
    hoursStart: l.hours_start,
    hoursEnd: l.hours_end,
    fullName: l.snap_full_name,
    employeeCode: l.snap_employee_code,
    departmentName: l.snap_department_name,
    subdepartmentName: l.snap_subdepartment_name,
    positionName: l.snap_position_name,
    managerName: l.snap_manager_name,
    unitName: l.snap_unit_name,
    docPath: l.doc_path,
    docFilename: l.doc_filename,
    createdBy: l.created_by,
    createdByName: nomePorId.get(l.created_by) ?? null,
    submittedAt: l.submitted_at,
    decidedAt: l.decided_at,
    decidedByName: l.decided_by ? nomePorId.get(l.decided_by) ?? null : null,
    decisionNote: l.decision_note,
    cancelledAt: l.cancelled_at,
    cancelNote: l.cancel_note,
    emailStatus: l.email_status,
    emailAt: l.email_at,
  }));

  // Regra sem faixa não corta nada, então só conta quem tem as duas coisas. É o
  // mesmo recorte que /metas faz antes de calcular.
  const regrasComFaixa = new Set((faixasRedutor ?? []).map((f) => f.rule_id));
  const kindsComRedutor = [...new Set(
    (regrasRedutor ?? [])
      .filter((r) => regrasComFaixa.has(r.id) && r.absence_kind)
      .map((r) => r.absence_kind as NonNullable<typeof r.absence_kind>),
  )];

  return (
    <div>
      <PageHeader
        title="Absenteísmos"
        subtitle="O não comparecimento vira ausência de verdade só depois que o RH aprova"
      />
      <AbsenteismosManager
        rows={rows}
        pessoas={pessoas}
        tipos={(tipos ?? []).map((t) => ({
          id: t.id, name: t.name, description: t.description, kind: t.kind,
          requiresDocument: t.requires_document, requiresMedical: t.requires_medical,
          requiresCompanion: t.requires_companion, requiresKinship: t.requires_kinship,
          discountsRvDefault: t.discounts_rv_default, active: t.active,
        }))}
        unidades={(unidadesTodas ?? [])
          .filter((u) => !unidades || unidades.includes(u.id))
          .map((u) => ({ id: u.id, name: u.name }))}
        kindsComRedutor={kindsComRedutor}
        meuId={user.id}
        podeDecidir={ehDp}
        podeCancelarAprovado={role === "owner" || role === "admin"}
      />
    </div>
  );
}
