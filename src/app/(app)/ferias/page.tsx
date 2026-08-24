import { requireContext, getMembers, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { minhaEquipe } from "@/lib/team";
import { moduleGate } from "@/lib/module-gate";
import { PageHeader } from "@/components/ui/PageHeader";
import { FeriasManager, type FeriasRow } from "@/components/FeriasManager";
import type { AquisitivoInfo } from "@/lib/ferias";

/**
 * Férias.
 *
 * O colaborador solicita a previsão (exceto os níveis operacionais, que são
 * programados pelo próprio gestor), o gestor aprova, e o DP confirma que está
 * calculada e EFETIVADA na folha. Só a efetivação cria a linha em
 * `employee_absences`, a base que RV, metas e treinamentos leem.
 *
 * Diferente de punições e absenteísmos, aqui a page abre para TODO MUNDO: o
 * colaborador comum precisa dela para pedir e acompanhar. O recorte de linhas é
 * da RLS (`pode_ver_ferias`); a page só decide abas e botões.
 */
export default async function FeriasPage() {
  const gate = await moduleGate("ferias");
  if (gate) return gate;

  const { tenant, user, role, unitScope } = await requireContext();
  const supabase = await createClient();

  const ehDp = role === "owner" || role === "admin" || role === "hr";
  const podeLiderar = ehDp || role === "manager" || role === "team_lead";

  // "hoje" no fuso do Brasil: o servidor está em UTC e às 21h o dia já teria
  // virado (a mesma lição do occurred_on do absenteísmo)
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })
    .format(new Date());

  const unidades = effectiveUnitFilter(unitScope);
  let lista = supabase
    .from("ferias_solicitacoes")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("start_date", { ascending: false })
    .limit(500);
  if (unidades) lista = lista.or(`snap_unit_id.in.(${unidades.join(",")}),snap_unit_id.is.null`);

  const [
    { data: linhas }, membros, equipe,
    { data: meuVinculo }, { data: bloqueados }, { data: feriados },
    { data: aquisitivos },
  ] = await Promise.all([
    lista,
    getMembers(tenant.id),
    podeLiderar ? minhaEquipe(supabase, tenant.id) : Promise.resolve([] as string[]),
    supabase
      .from("memberships")
      .select("admission_date, hierarchy_level_id")
      .eq("tenant_id", tenant.id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("ferias_niveis_bloqueados").select("hierarchy_level_id").eq("tenant_id", tenant.id),
    supabase.from("holidays").select("day, name").eq("tenant_id", tenant.id),
    supabase.rpc("ferias_periodos_aquisitivos", {
      p_tenant: tenant.id, p_user: user.id, p_hoje: hoje,
    }),
  ]);

  const nomePorId = new Map<string, string>();
  for (const m of membros) {
    if (m.profile?.id) nomePorId.set(m.profile.id, m.profile.full_name ?? "");
  }

  const rows: FeriasRow[] = (linhas ?? []).map((l) => ({
    id: l.id,
    status: l.status,
    userId: l.user_id,
    startDate: l.start_date,
    endDate: l.end_date,
    dias: l.dias,
    abonoDias: l.abono_dias,
    decimo: l.adiantar_decimo_terceiro,
    aquisitivoInicio: l.aquisitivo_inicio,
    aquisitivoFim: l.aquisitivo_fim,
    reagendadaDe: l.reagendada_de,
    fullName: l.snap_full_name,
    employeeCode: l.snap_employee_code,
    departmentName: l.snap_department_name,
    subdepartmentName: l.snap_subdepartment_name,
    positionName: l.snap_position_name,
    managerName: l.snap_manager_name,
    unitName: l.snap_unit_name,
    hierarchyName: l.snap_hierarchy_name,
    createdBy: l.created_by,
    createdByName: nomePorId.get(l.created_by) ?? null,
    lancadaPeloGestor: l.lancada_pelo_gestor,
    decidedAt: l.decided_at,
    decidedByName: l.decided_by ? nomePorId.get(l.decided_by) ?? null : null,
    decisionNote: l.decision_note,
    efetivadaAt: l.efetivada_at,
    efetivadaByName: l.efetivada_by ? nomePorId.get(l.efetivada_by) ?? null : null,
    efetivacaoNote: l.efetivacao_note,
    cancelledAt: l.cancelled_at,
    cancelNote: l.cancel_note,
    createdAt: l.created_at,
  }));

  const nivelBloqueado = !!meuVinculo?.hierarchy_level_id
    && (bloqueados ?? []).some((b) => b.hierarchy_level_id === meuVinculo.hierarchy_level_id);
  const semAdmissao = !meuVinculo?.admission_date;
  const podeSolicitar = !nivelBloqueado && !semAdmissao;
  const avisoSolicitar = nivelBloqueado
    ? "As férias do seu nível são programadas pelo seu gestor. Você acompanha por aqui o saldo e as previsões lançadas para você."
    : semAdmissao
      ? "Sua data de admissão ainda não está cadastrada, então o saldo não pode ser calculado. Peça ao departamento pessoal para completar o seu cadastro."
      : null;

  // Para quem o usuário pode lançar: o DP para qualquer colaborador ativo, o
  // gestor para a própria cadeia. O servidor revalida (manages_user / papel).
  const alcanceLancar = ehDp ? [...nomePorId.keys()] : equipe;
  const pessoasLancar = alcanceLancar
    .filter((id) => id !== user.id)
    .map((id) => ({ id, name: nomePorId.get(id) ?? "" }))
    .filter((p) => p.name)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const meusAquisitivos: AquisitivoInfo[] = (aquisitivos ?? []).map((a) => ({
    aqInicio: a.aq_inicio,
    aqFim: a.aq_fim,
    concessivoFim: a.concessivo_fim,
    diasDireito: a.dias_direito,
    diasUsados: a.dias_usados,
    abonoUsado: a.abono_usado,
    saldo: a.saldo,
    qtdPeriodos: a.qtd_periodos,
    situacao: a.situacao,
  }));

  return (
    <div>
      <PageHeader
        title="Férias"
        subtitle="A previsão vira ausência de verdade só depois que o departamento pessoal efetiva"
      />
      <FeriasManager
        rows={rows}
        meuId={user.id}
        ehDp={ehDp}
        ehOwner={role === "owner"}
        ehGestor={podeLiderar && (ehDp || equipe.length > 0)}
        podeSolicitar={podeSolicitar}
        avisoSolicitar={avisoSolicitar}
        pessoasLancar={pessoasLancar}
        meusAquisitivos={meusAquisitivos}
        feriados={(feriados ?? []).map((f) => ({ day: f.day, name: f.name }))}
        hoje={hoje}
      />
    </div>
  );
}
