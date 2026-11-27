import { requireContext, getMembers, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { minhaEquipe } from "@/lib/team";
import { moduleGate } from "@/lib/module-gate";
import {
  FeriasManager, type FeriasPainel, type FeriasRow, type UltimaImportacaoFolha,
} from "@/components/FeriasManager";
import {
  anoDaEscolhaDecimo, aquisitivoDaLinha,
  type AquisitivoInfo, type DecimoPelaEscolha, type EscolhaDecimoDaEquipe,
} from "@/lib/ferias";

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

  const { tenant, user, role, unitScope, isDp, isGente } = await requireContext();
  const supabase = await createClient();

  const ehDp = isDp;
  // Área de Gente (LUIZ, 19/11/2026): as abas do DP, só para ler
  const veComoDp = isGente && !ehDp;
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

  // As três leituras do 13º vinham em fila DEPOIS do lote (desempenho, LUIZ
  // 18/11/2026). Agora cada uma sai assim que o que ela precisa chega, em
  // paralelo com o resto: a escolha da própria pessoa espera só o vínculo e os
  // níveis bloqueados; o painel da equipe espera só a configuração (o ano da
  // escolha depende do prazo); a espera da efetivação não depende de nada.
  const meuVinculoP = supabase
    .from("memberships")
    .select("admission_date, hierarchy_level_id, fora_da_folha")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .maybeSingle();
  // quem está fora da folha (sócios) não tem férias (LUIZ, 27/11/2026)
  const foraDaFolhaP = supabase.from("memberships").select("user_id")
    .eq("tenant_id", tenant.id).eq("fora_da_folha", true);
  const bloqueadosP = supabase.from("ferias_niveis_bloqueados").select("hierarchy_level_id").eq("tenant_id", tenant.id);
  // antecedência mínima por quem lança (Configurações > Férias)
  const configP = supabase
    .from("ferias_config")
    .select("antecedencia_minima_dias, antecedencia_gestor_dias, antecedencia_dp_dias, abono_fora_prazo, decimo_fora_prazo, decimo_prazo")
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  const nivelBloqueadoP = Promise.all([meuVinculoP, bloqueadosP]).then(([{ data: v }, { data: b }]) =>
    !!v?.hierarchy_level_id && (b ?? []).some((x) => x.hierarchy_level_id === v.hierarchy_level_id));
  // quem não solicita as próprias férias escolhe, por ano, o adiantamento do 13º
  const minhaEscolhaP = (async () => (await nivelBloqueadoP)
    ? (await supabase.rpc("ferias_escolhas_decimo", { p_tenant: tenant.id, p_user: user.id })).data
    : null)();
  // quem acompanha equipe vê se os operacionais já escolheram o 13º do ano
  const anoDecimoP = configP.then(({ data }) => anoDaEscolhaDecimo(hoje, data?.decimo_prazo ?? "01-31"));
  const escolhasDaEquipeP = (async () => (ehDp || veComoDp || role === "manager" || podeLiderar)
    ? (await supabase.rpc("ferias_painel_decimo", { p_tenant: tenant.id, p_ano: await anoDecimoP, p_unit_ids: unidades })).data
    : null)();

  const [
    { data: linhas }, membros, equipe,
    { data: meuVinculo }, { data: bloqueados }, { data: feriados },
    { data: aquisitivos }, { data: painel }, { data: importacao }, { data: setores },
    { data: config },
    minhaEscolha, anoDecimo, escolhasDaEquipe, { data: esperaDecimo },
  ] = await Promise.all([
    lista,
    getMembers(tenant.id),
    podeLiderar ? minhaEquipe(supabase, tenant.id) : Promise.resolve([] as string[]),
    meuVinculoP,
    bloqueadosP,
    supabase.from("holidays").select("day, name").eq("tenant_id", tenant.id),
    supabase.rpc("ferias_periodos_aquisitivos", {
      p_tenant: tenant.id, p_user: user.id, p_hoje: hoje,
    }),
    // o painel decide o escopo por dentro (DP e manager = empresa, team_lead =
    // cadeia, member = só ele); a unidade do topo só encolhe
    supabase.rpc("ferias_painel", {
      p_tenant: tenant.id, p_hoje: hoje, p_unit_ids: unidades,
    }),
    // a empresa importa os aquisitivos da folha? (e, para o DP, a última importação)
    supabase.rpc("ferias_situacao_importacao", { p_tenant: tenant.id }),
    // a cor de cada setor no calendário vem da posição dele no cadastro
    supabase.from("departments").select("id, name").eq("tenant_id", tenant.id),
    configP,
    minhaEscolhaP,
    anoDecimoP,
    escolhasDaEquipeP,
    // DP: o banco recusa efetivar enquanto o operacional não escolhe o 13º do ano
    ehDp || veComoDp
      ? supabase.rpc("ferias_efetivacao_aguardando_decimo", { p_tenant: tenant.id })
      : Promise.resolve({ data: null }),
  ]);

  const situacaoFolha = (importacao ?? null) as {
    usaFolha?: boolean; ultima?: UltimaImportacaoFolha | null;
  } | null;
  const usaFolha = !!situacaoFolha?.usaFolha;

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
    emDobro: l.em_dobro,
    justificativaDobro: l.justificativa_dobro,
    abonoForaPrazo: l.abono_fora_prazo,
    decimoForaPrazo: l.decimo_fora_prazo,
    createdAt: l.created_at,
  }));

  const meusAquisitivos: AquisitivoInfo[] = (aquisitivos ?? []).map(aquisitivoDaLinha);

  const nivelBloqueado = !!meuVinculo?.hierarchy_level_id
    && (bloqueados ?? []).some((b) => b.hierarchy_level_id === meuVinculo.hierarchy_level_id);
  const semAdmissao = !meuVinculo?.admission_date;
  // A empresa importa da folha e a pessoa não veio no relatório: não há saldo
  // conferível, e o banco recusaria o pedido de qualquer jeito.
  const semFolha = usaFolha && meusAquisitivos.length === 0;
  const foraDaFolha = meuVinculo?.fora_da_folha === true;
  const podeSolicitar = !foraDaFolha && !nivelBloqueado && !semAdmissao && !semFolha;
  const escolhasDecimo = nivelBloqueado
    ? ((minhaEscolha as unknown as DecimoPelaEscolha | null)?.escolhas ?? [])
    : null;
  const painelDecimo = escolhasDaEquipe
    ? { ano: anoDecimo, pessoas: escolhasDaEquipe as unknown as EscolhaDecimoDaEquipe[] }
    : null;
  const aguardandoDecimo: Record<string, string> = Object.fromEntries(
    (esperaDecimo ?? []).map((e) => [e.solicitacao_id, e.prazo]),
  );
  const avisoSolicitar = foraDaFolha
    ? "Seu cadastro está fora da folha de pagamento, então não há férias a solicitar."
    : nivelBloqueado
    ? "As férias do seu nível são programadas pelo seu gestor. Você acompanha por aqui o saldo e as previsões lançadas para você."
    : semAdmissao
      ? "Sua data de admissão ainda não está cadastrada, então o saldo não pode ser calculado. Peça ao departamento pessoal para completar o seu cadastro."
      : semFolha
        ? "Seus períodos aquisitivos de férias ainda não foram importados, então o saldo não pode ser conferido. Procure o departamento pessoal."
        : null;

  // Para quem o usuário pode lançar: o DP para qualquer colaborador ativo, o
  // gestor para a própria cadeia. O servidor revalida (manages_user / papel).
  const alcanceLancar = ehDp ? [...nomePorId.keys()] : equipe;
  const semFerias = new Set(((await foraDaFolhaP).data ?? []).map((m) => m.user_id));
  const pessoasLancar = alcanceLancar
    .filter((id) => id !== user.id && !semFerias.has(id))
    .map((id) => ({ id, name: nomePorId.get(id) ?? "" }))
    .filter((p) => p.name)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div>
      {/* o cabeçalho é desenhado pelo FeriasManager: o menu de ações dele
          depende dos diálogos que moram lá */}
      <FeriasManager
        rows={rows}
        meuId={user.id}
        ehDp={ehDp}
        veComoDp={veComoDp}
        ehOwner={role === "owner"}
        ehGestor={podeLiderar && (ehDp || equipe.length > 0)}
        equipe={equipe}
        // a RLS abre a empresa toda ao DP, ao Gerencial e à Área de Gente
        vejoEmpresa={ehDp || veComoDp || role === "manager"}
        podeSolicitar={podeSolicitar}
        avisoSolicitar={avisoSolicitar}
        pessoasLancar={pessoasLancar}
        meusAquisitivos={meusAquisitivos}
        feriados={(feriados ?? []).map((f) => ({ day: f.day, name: f.name }))}
        hoje={hoje}
        painel={(painel ?? null) as FeriasPainel | null}
        usaFolha={usaFolha}
        ultimaImportacao={situacaoFolha?.ultima ?? null}
        setores={(setores ?? []).map((s) => ({ id: s.id, name: s.name }))}
        unidades={unidades}
        antecedencia={{
          colaborador: config?.antecedencia_minima_dias ?? 0,
          gestor: config?.antecedencia_gestor_dias ?? 0,
          dp: config?.antecedencia_dp_dias ?? 0,
        }}
        prazos={{
          abono: config?.abono_fora_prazo === "bloquear" ? "bloquear" : "alerta",
          decimo: config?.decimo_fora_prazo === "bloquear" ? "bloquear" : "alerta",
          decimoAte: config?.decimo_prazo ?? "01-31",
        }}
        escolhasDecimo={escolhasDecimo}
        painelDecimo={painelDecimo}
        aguardandoDecimo={aguardandoDecimo}
      />
    </div>
  );
}
