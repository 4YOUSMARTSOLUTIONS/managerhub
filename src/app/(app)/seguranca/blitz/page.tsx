import { requireContext, getMembers, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { moduleGate } from "@/lib/module-gate";
import { SegBlitzManager, type BlitzRow } from "@/components/SegBlitzManager";
import type { BlitzJaPassou } from "@/components/SegBlitzDialog";
import { getBlitzAlertas } from "@/lib/actions/seguranca";
import type { BlitzAlertaAnalise, BlitzAnaliseDados } from "@/lib/blitz-aderencia";

/**
 * Blitz de trajeto.
 *
 * Duas caras na mesma rota, como os relatos: quem pode avaliar (gestor para
 * cima, equipe de segurança) vê a lista completa e o botão de nova blitz; o
 * colaborador comum vê as próprias, porque ele sabe que passou e tem direito
 * de ver no que deu. Quem decide isso é a RLS (`pode_ver_blitz`), não esta
 * página: a consulta é a mesma para todo mundo e volta recortada.
 */
export default async function SegurancaBlitzPage() {
  const gate = await moduleGate("seg_blitz");
  if (gate) return gate;

  const { tenant, unitScope, role, user } = await requireContext();
  const supabase = await createClient();

  const unidades = effectiveUnitFilter(unitScope);
  let lista = supabase
    .from("seg_blitz_avaliacoes")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (unidades) lista = lista.or(`unit_id.in.(${unidades.join(",")}),unit_id.is.null`);

  const [
    { data: blitzes }, { data: podeAvaliar }, membros,
    { data: meios }, { data: perguntas }, { data: perguntaMeios },
    { data: motivos }, { data: veiculos },
    alertas, { data: daSeguranca },
  ] = await Promise.all([
    lista,
    supabase.rpc("pode_avaliar_blitz", { p_tenant: tenant.id }),
    getMembers(tenant.id),
    supabase.from("seg_blitz_meios").select("id, name, image_path, tem_veiculo, active")
      .eq("tenant_id", tenant.id).order("sort").order("name"),
    supabase.from("seg_blitz_perguntas").select("id, name, active")
      .eq("tenant_id", tenant.id).order("sort").order("name"),
    supabase.from("seg_blitz_pergunta_meios").select("pergunta_id, meio_id").eq("tenant_id", tenant.id),
    supabase.from("seg_blitz_motivos").select("id, name, active")
      .eq("tenant_id", tenant.id).order("sort").order("name"),
    // o veículo mais recente de cada colaborador vira a sugestão do formulário
    supabase.from("seg_veiculos").select("user_id, meio_id, placa, tipo_descricao, propriedade, cor, updated_at")
      .eq("tenant_id", tenant.id).eq("active", true).order("updated_at", { ascending: false }),
    // os alertas do usuário logado como gestor
    getBlitzAlertas(),
    supabase.rpc("is_safety_member", { p_tenant: tenant.id }),
  ]);
  /**
   * A aba Análises (indicadores e recorrência) é de quem tem alçada: gestor,
   * gerência, administração e equipe de segurança. O avaliador da blitz (e o
   * colaborador comum) fica só com a lista: decisão do LUIZ, 10/11/2026.
   */
  const temAlcada = role === "owner" || role === "admin" || role === "manager" || role === "team_lead" || daSeguranca === true;

  // Análises do mês corrente (o filtro da tela troca o período). O público
  // da blitz se configura em Configurações > Segurança.
  const hojeSp = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const [anoAtual, mesNum] = hojeSp.split("-").map(Number);
  const fimDoMes = `${hojeSp.slice(0, 7)}-${String(new Date(anoAtual, mesNum, 0).getDate()).padStart(2, "0")}`;
  const argsDoMes = { p_de: `${hojeSp.slice(0, 7)}-01`, p_ate: fimDoMes, p_unit_ids: unidades };
  const [analiseRes, alertasRes] = temAlcada
    ? await Promise.all([
        supabase.rpc("seg_blitz_analise", argsDoMes),
        supabase.rpc("seg_blitz_alertas_do_periodo", argsDoMes),
      ])
    : [{ data: null }, { data: null }];
  // "Todos | Minha gestão" (LUIZ, 11/11/2026): para quem vê a empresa inteira e
  // também tem gente embaixo. O Gestor já vê só a cadeia dele
  const veAEmpresa = role === "owner" || role === "admin" || role === "manager" || daSeguranca === true;
  const { count: diretos } = veAEmpresa
    ? await supabase.from("memberships").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id).eq("manager_id", user.id).eq("is_active", true)
    : { count: 0 };
  const podeEscolherGestao = veAEmpresa && (diretos ?? 0) > 0;
  const analise = analiseRes.data
    ? {
        ...(analiseRes.data as unknown as BlitzAnaliseDados),
        alertas: (alertasRes.data ?? []) as unknown as BlitzAlertaAnalise[],
      }
    : null;
  // a blitz começou em 2026: o filtro oferece de lá até o ano corrente
  const anos = Array.from({ length: Math.max(1, anoAtual - 2026 + 1) }, (_, i) => anoAtual - i);

  const ids = (blitzes ?? []).map((b) => b.id);
  const { data: respostas } = ids.length
    ? await supabase
        .from("seg_blitz_respostas")
        .select("avaliacao_id, snap_pergunta, resposta")
        .in("avaliacao_id", ids)
    : { data: [] };

  const respostasPorBlitz = new Map<string, BlitzRow["respostas"]>();
  for (const r of respostas ?? []) {
    const atual = respostasPorBlitz.get(r.avaliacao_id) ?? [];
    atual.push({ pergunta: r.snap_pergunta, resposta: r.resposta });
    respostasPorBlitz.set(r.avaliacao_id, atual);
  }

  // com a matrícula: na portaria, o crachá é mais rápido que o nome
  const pessoas = membros
    .filter((m): m is typeof m & { profile: NonNullable<typeof m.profile> } => !!m.profile)
    .map((m) => ({ id: m.profile.id, name: m.profile.full_name ?? m.profile.email ?? "—", code: m.code }));
  const nomeDoUser = new Map(pessoas.map((p) => [p.id, p.name]));
  const matriculaDo = new Map(pessoas.map((p) => [p.id, p.code]));

  const nomeMotivo = new Map((motivos ?? []).map((m) => [m.id, m.name]));

  // um veículo por colaborador: o mais recente (a query já vem ordenada)
  const veiculoPorUser = new Map<string, NonNullable<typeof veiculos>[number]>();
  for (const v of veiculos ?? []) {
    if (!veiculoPorUser.has(v.user_id)) veiculoPorUser.set(v.user_id, v);
  }

  // hora e dia do registro no fuso de São Paulo (o servidor roda em UTC)
  const diaSp = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
  const horaSp = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

  const rows: BlitzRow[] = (blitzes ?? []).map((b) => ({
    id: b.id,
    occurredOn: b.occurred_on,
    registroDia: diaSp.format(new Date(b.registrada_em)),
    registroHora: horaSp.format(new Date(b.registrada_em)),
    userId: b.user_id,
    matricula: matriculaDo.get(b.user_id) ?? null,
    pessoa: b.snap_full_name,
    setor: b.snap_department_name,
    gestor: b.snap_manager_name,
    unidade: b.snap_unit_name,
    funcao: b.snap_position_name,
    meioId: b.meio_id,
    placa: b.placa,
    veiculoTipo: b.veiculo_tipo,
    propriedade: b.propriedade,
    cor: b.cor,
    liberado: b.liberado,
    motivoNome: b.motivo_bloqueio_id ? nomeMotivo.get(b.motivo_bloqueio_id) ?? null : null,
    observacao: b.observacao,
    conforme: b.conforme,
    avaliador: nomeDoUser.get(b.created_by) ?? null,
    respostas: respostasPorBlitz.get(b.id) ?? [],
  }));

  // quem já passou pela blitz neste mês, de qualquer avaliador: o formulário
  // avisa ao escolher a pessoa (LUIZ, 11/11/2026: Arthur lançado duas vezes)
  const { data: jaPassaramRes } = podeAvaliar === true
    ? await supabase.rpc("seg_blitz_ja_passaram_no_mes")
    : { data: null };
  const jaPassaram: Record<string, BlitzJaPassou> = Object.fromEntries(
    ((jaPassaramRes ?? []) as unknown as { user_id: string; vezes: number; occurred_on: string; registrada_em: string }[])
      .map((x) => {
        const quando = new Date(x.registrada_em);
        // a hora só vale quando o registro foi no próprio dia da blitz
        return [x.user_id, { vezes: x.vezes, dia: x.occurred_on, hora: diaSp.format(quando) === x.occurred_on ? horaSp.format(quando) : null }];
      }),
  );

  return (
    <div>
      <SegBlitzManager
        jaPassaram={jaPassaram}
        dono={user.id}
        tenantId={tenant.id}
        rows={rows}
        podeAvaliar={podeAvaliar === true}
        ehProprietario={role === "owner"}
        pessoas={pessoas}
        meios={(meios ?? []).map((m) => ({
          id: m.id, name: m.name, imagePath: m.image_path, temVeiculo: m.tem_veiculo, active: m.active,
        }))}
        perguntas={(perguntas ?? []).map((q) => ({
          id: q.id, name: q.name, active: q.active,
          meioIds: (perguntaMeios ?? []).filter((v) => v.pergunta_id === q.id).map((v) => v.meio_id),
        }))}
        motivos={(motivos ?? []).map((m) => ({ id: m.id, name: m.name, active: m.active }))}
        veiculos={[...veiculoPorUser.values()].map((v) => ({
          userId: v.user_id, meioId: v.meio_id, placa: v.placa,
          tipoDescricao: v.tipo_descricao, propriedade: v.propriedade, cor: v.cor,
        }))}
        analise={analise ? {
          inicial: analise, unitIds: unidades, hoje: hojeSp, anos, podeEscolherGestao,
        } : null}
        alertas={alertas}
      />
    </div>
  );
}
