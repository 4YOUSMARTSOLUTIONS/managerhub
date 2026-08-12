import { requireContext, getMembers, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { minhaEquipe } from "@/lib/team";
import { moduleGate } from "@/lib/module-gate";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { PunicoesManager, type PunicaoRow } from "@/components/PunicoesManager";

/**
 * Lançamento de punições.
 *
 * O gestor preenche, imprime para colher assinaturas, anexa o documento
 * assinado e envia ao RH. Só a aprovação do RH cria a punição de verdade, em
 * `employee_sanctions`, que é a tabela que o redutor da remuneração variável lê.
 * Enquanto o lançamento não for aprovado, ele não vale nada, e a tela diz isso.
 *
 * O recorte de quem vê o quê é da RLS (`pode_ver_punicao`): autor, gestor da
 * pessoa, ou RH/administrador/proprietário. A tela não repete esse filtro; o que
 * ela faz é separar em abas o que já veio filtrado.
 */
export default async function PunicoesPage() {
  const gate = await moduleGate("punicoes");
  if (gate) return gate;

  const { tenant, user, role, unitScope } = await requireContext();
  const ehDp = role === "owner" || role === "admin" || role === "hr";
  // Quem tem alçada sobre alguém. O Funcionário não entra: ele não lança nem
  // acompanha punição, nem a própria (o documento é entregue em papel). O menu
  // já esconde a tela dele pelo `minRole`, e esta guarda é a que vale para quem
  // digitar a URL na mão.
  const podeAbrir = ehDp || role === "manager" || role === "team_lead";
  const supabase = await createClient();

  if (!podeAbrir) {
    return (
      <div>
        <PageHeader title="Punições" />
        <EmptyState
          title="Acesso restrito"
          description="Punição é lançada pelo gestor da pessoa e aprovada pelo RH. Quem não faz nem uma coisa nem outra não acompanha lançamentos por aqui."
        />
      </div>
    );
  }

  const equipe = ehDp ? [] : await minhaEquipe(supabase, tenant.id);

  if (!ehDp && equipe.length === 0) {
    return (
      <div>
        <PageHeader title="Punições" subtitle={tenant.name} />
        <EmptyState
          title="Nada para lançar por aqui"
          description="Punição é lançada pelo gestor da pessoa e aprovada pelo RH. Assim que houver alguém sob sua gestão, o formulário aparece nesta tela."
        />
      </div>
    );
  }

  // O filtro de unidade é o do seletor do topo, sobre a unidade CARIMBADA no
  // lançamento. Lançamento sem unidade continua aparecendo em qualquer recorte,
  // pela mesma razão de /acoes e /checklists: sumir sem aviso é pior que
  // aparecer demais.
  const unidades = effectiveUnitFilter(unitScope);
  let lista = supabase
    .from("punicao_lancamentos")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (unidades) lista = lista.or(`snap_unit_id.in.(${unidades.join(",")}),snap_unit_id.is.null`);

  const [
    { data: lancamentos }, membros, { data: infracoes }, { data: punicoes },
    { data: vinculos }, { data: deps }, { data: subs }, { data: cargos },
    { data: vinculoUnidades }, { data: unidadesTodas },
  ] = await Promise.all([
    lista,
    getMembers(tenant.id),
    supabase
      .from("infraction_types")
      .select("id, code, name, description, severity, active")
      .eq("tenant_id", tenant.id)
      .order("code"),
    supabase
      .from("sanction_types")
      .select("id, name, active")
      .eq("tenant_id", tenant.id)
      .order("sort")
      .order("name"),
    // a ficha que o formulário mostra em leitura. Sem CPF: ele só aparece no
    // documento, por RPC (ver AGENTS.md).
    supabase
      .from("memberships")
      .select("id, user_id, employee_code, department_id, subdepartment_id, position_id, manager_id")
      .eq("tenant_id", tenant.id),
    supabase.from("departments").select("id, name").eq("tenant_id", tenant.id),
    supabase.from("subdepartments").select("id, name").eq("tenant_id", tenant.id),
    supabase.from("positions").select("id, name").eq("tenant_id", tenant.id),
    supabase.from("membership_units").select("membership_id, unit_id").limit(20000),
    supabase.from("units").select("id, name").eq("tenant_id", tenant.id),
  ]);

  const nomePorId = new Map<string, string>();
  for (const m of membros) {
    if (m.profile?.id) nomePorId.set(m.profile.id, m.profile.full_name ?? "");
  }

  // A quem este usuário pode aplicar punição. Para o RH e a administração é o
  // quadro inteiro; para o gestor, a cadeia abaixo dele. É o mesmo conjunto que
  // a policy de insert aceita, então a lista não oferece o que o banco recusaria.
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

  const rows: PunicaoRow[] = (lancamentos ?? []).map((l) => ({
    id: l.id,
    status: l.status,
    userId: l.user_id,
    appliedOn: l.applied_on,
    infractionTypeId: l.infraction_type_id,
    infractionCode: l.infraction_code,
    infractionName: l.infraction_name,
    infractionDescription: l.infraction_description,
    severity: l.severity,
    sanctionTypeId: l.sanction_type_id,
    sanctionName: l.sanction_name,
    extraInfo: l.extra_info,
    fullName: l.snap_full_name,
    employeeCode: l.snap_employee_code,
    departmentName: l.snap_department_name,
    subdepartmentName: l.snap_subdepartment_name,
    positionName: l.snap_position_name,
    managerName: l.snap_manager_name,
    unitName: l.snap_unit_name,
    signedPath: l.signed_path,
    signedFilename: l.signed_filename,
    createdBy: l.created_by,
    createdByName: nomePorId.get(l.created_by) ?? null,
    submittedAt: l.submitted_at,
    decidedAt: l.decided_at,
    decidedByName: l.decided_by ? nomePorId.get(l.decided_by) ?? null : null,
    decisionNote: l.decision_note,
    cancelledAt: l.cancelled_at,
    cancelNote: l.cancel_note,
  }));

  return (
    <div>
      <PageHeader
        title="Punições"
        subtitle="O lançamento vira punição de verdade só depois que o RH aprova"
      />
      <PunicoesManager
        rows={rows}
        pessoas={pessoas}
        infracoes={(infracoes ?? []).map((i) => ({
          id: i.id, code: i.code, name: i.name,
          description: i.description, severity: i.severity, active: i.active,
        }))}
        punicoes={(punicoes ?? []).map((p) => ({ id: p.id, name: p.name, active: p.active }))}
        meuId={user.id}
        podeDecidir={ehDp}
        podeCancelar={role === "owner" || role === "admin"}
      />
    </div>
  );
}
