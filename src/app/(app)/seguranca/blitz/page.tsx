import { requireContext, getMembers, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { moduleGate } from "@/lib/module-gate";
import { SegBlitzManager } from "@/components/SegBlitzManager";
import type { BlitzJaPassou, BlitzUltimaComNok } from "@/components/SegBlitzDialog";
import { getBlitzAlertas } from "@/lib/actions/seguranca";
import type { BlitzAlertaAnalise, BlitzAnaliseDados } from "@/lib/blitz-aderencia";
import { lerRegistrosDaBlitz } from "@/lib/blitz-registros";
import { regrasDaLinha } from "@/lib/blitz-regras";

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

  const { tenant, unitScope, role, user, isAvaliadorBlitz } = await requireContext();
  const supabase = await createClient();

  const unidades = effectiveUnitFilter(unitScope);

  // Uma rodada só (desempenho, LUIZ 18/11/2026). Antes eram quatro em fila: o
  // lote, depois análises e registros, depois a contagem de diretos, depois
  // "quem já passou no mês". As três últimas dependem só de duas perguntas
  // rápidas (é da segurança? pode avaliar?), então cada uma sai assim que a
  // sua pergunta responde, em paralelo com o lote.
  const podeAvaliarP = supabase.rpc("pode_avaliar_blitz", { p_tenant: tenant.id });
  const daSegurancaP = supabase.rpc("is_safety_member", { p_tenant: tenant.id });

  /**
   * A aba Análises (indicadores e recorrência) é de quem tem alçada: gestor,
   * gerência, administração, equipe de segurança e, desde 18/11/2026, o
   * avaliador da blitz, que vê a empresa inteira (LUIZ). O colaborador comum
   * fica só com a lista das próprias.
   */
  const temAlcadaP = daSegurancaP.then(({ data }) =>
    role === "owner" || role === "admin" || role === "manager" || role === "team_lead" || data === true || isAvaliadorBlitz);
  // "Todos | Minha gestão" (LUIZ, 11/11/2026): para quem vê a empresa inteira e
  // também tem gente embaixo. O Gestor já vê só a cadeia dele
  const veAEmpresaP = daSegurancaP.then(({ data }) =>
    role === "owner" || role === "admin" || role === "manager" || data === true || isAvaliadorBlitz);

  // Análises do mês corrente (o filtro da tela troca o período). O público
  // da blitz se configura em Configurações > Segurança.
  const hojeSp = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const [anoAtual, mesNum] = hojeSp.split("-").map(Number);
  const fimDoMes = `${hojeSp.slice(0, 7)}-${String(new Date(anoAtual, mesNum, 0).getDate()).padStart(2, "0")}`;
  const argsDoMes = { p_de: `${hojeSp.slice(0, 7)}-01`, p_ate: fimDoMes, p_unit_ids: unidades };
  const analiseDoMesP = (async () => (await temAlcadaP)
    ? Promise.all([
        supabase.rpc("seg_blitz_analise", argsDoMes),
        supabase.rpc("seg_blitz_alertas_do_periodo", argsDoMes),
      ])
    : null)();
  // Registros: com alçada, o mês corrente (o período das Análises busca o resto);
  // sem alçada, tudo que a pessoa alcança. Paginado, sem o antigo corte em 500
  const registrosP = (async () => lerRegistrosDaBlitz(
    tenant.id, (await temAlcadaP) ? { de: argsDoMes.p_de, ate: fimDoMes, unidades } : { unidades },
  ))();
  const diretosP = (async () => (await veAEmpresaP)
    ? (await supabase.from("memberships").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id).eq("manager_id", user.id).eq("is_active", true)).count
    : 0)();
  // quem já passou pela blitz neste mês, de qualquer avaliador: o formulário
  // avisa ao escolher a pessoa (LUIZ, 11/11/2026: Arthur lançado duas vezes)
  const jaPassaramP = (async () => (await podeAvaliarP).data === true
    ? (await supabase.rpc("seg_blitz_ja_passaram_no_mes")).data
    : null)();
  // o que deu "não" na última blitz de cada um: o formulário avisa ao escolher
  // a pessoa (LUIZ, 18/11/2026). Vem com a página para valer sem sinal
  const ultimaComNokP = (async () => (await podeAvaliarP).data === true
    ? (await supabase.rpc("seg_blitz_ultima_com_nok")).data
    : null)();
  // quem terá a blitz educativa (contratado a partir da data, nunca passou):
  // o formulário avisa, também sem sinal (LUIZ, 18/11/2026)
  const educativaParaP = (async () => (await podeAvaliarP).data === true
    ? (await supabase.rpc("seg_blitz_educativa_para")).data
    : null)();

  const [
    { data: podeAvaliar }, membros,
    { data: meios }, { data: perguntas }, { data: perguntaMeios },
    { data: motivos }, { data: veiculos },
    alertas,
    veAEmpresa, analiseDoMes, registros, diretos, jaPassaramRes, ultimaComNokRes, educativaParaRes,
    { data: regrasLinha }, { data: daSeguranca },
  ] = await Promise.all([
    podeAvaliarP,
    getMembers(tenant.id),
    supabase.from("seg_blitz_meios").select("id, name, image_path, tem_veiculo, active")
      .eq("tenant_id", tenant.id).order("sort").order("name"),
    supabase.from("seg_blitz_perguntas").select("id, name, active")
      .eq("tenant_id", tenant.id).order("sort").order("name"),
    supabase.from("seg_blitz_pergunta_meios").select("pergunta_id, meio_id").eq("tenant_id", tenant.id),
    supabase.from("seg_blitz_motivos").select("id, name, active")
      .eq("tenant_id", tenant.id).order("sort").order("name"),
    // o veículo mais recente de cada colaborador vira a sugestão do formulário
    // paginado: é um por veículo da empresa e passa de 1000 sem avisar
    fetchAll(() => supabase.from("seg_veiculos").select("user_id, meio_id, placa, tipo_descricao, propriedade, cor, updated_at")
      .eq("tenant_id", tenant.id).eq("active", true).order("updated_at", { ascending: false }).order("id")),
    // os alertas do usuário logado como gestor
    getBlitzAlertas(),
    veAEmpresaP,
    analiseDoMesP,
    registrosP,
    diretosP,
    jaPassaramP,
    ultimaComNokP,
    educativaParaP,
    // as regras da empresa: os textos do formulário dizem o que acontece com a blitz
    supabase.from("seg_settings")
      .select("blitz_educativa_ativa, blitz_educativa_desde, blitz_tratativa_modo, blitz_recorrencia_qtd, blitz_recorrencia_dias, blitz_bloqueio_imediato")
      .eq("tenant_id", tenant.id).maybeSingle(),
    daSegurancaP,
  ]);
  const [analiseRes, alertasRes] = analiseDoMes ?? [{ data: null }, { data: null }];
  if (registros.error !== null) console.error("[blitz] registros:", registros.error);
  const rows = registros.data ?? [];
  const podeEscolherGestao = veAEmpresa && (diretos ?? 0) > 0;
  const analise = analiseRes.data
    ? {
        ...(analiseRes.data as unknown as BlitzAnaliseDados),
        alertas: (alertasRes.data ?? []) as unknown as BlitzAlertaAnalise[],
      }
    : null;
  // a blitz começou em 2026: o filtro oferece de lá até o ano corrente
  const anos = Array.from({ length: Math.max(1, anoAtual - 2026 + 1) }, (_, i) => anoAtual - i);

  // com a matrícula: na portaria, o crachá é mais rápido que o nome
  const pessoas = membros
    .filter((m): m is typeof m & { profile: NonNullable<typeof m.profile> } => !!m.profile)
    .map((m) => ({ id: m.profile.id, name: m.profile.full_name ?? m.profile.email ?? "—", code: m.code }));

  // um veículo por colaborador: o mais recente (a query já vem ordenada)
  const veiculoPorUser = new Map<string, NonNullable<typeof veiculos>[number]>();
  for (const v of veiculos ?? []) {
    if (!veiculoPorUser.has(v.user_id)) veiculoPorUser.set(v.user_id, v);
  }

  // hora e dia do registro no fuso de São Paulo (o servidor roda em UTC)
  const diaSp = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
  const horaSp = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

  const jaPassaram: Record<string, BlitzJaPassou> = Object.fromEntries(
    ((jaPassaramRes ?? []) as unknown as { user_id: string; vezes: number; occurred_on: string; registrada_em: string }[])
      .map((x) => {
        const quando = new Date(x.registrada_em);
        // a hora só vale quando o registro foi no próprio dia da blitz
        return [x.user_id, { vezes: x.vezes, dia: x.occurred_on, hora: diaSp.format(quando) === x.occurred_on ? horaSp.format(quando) : null }];
      }),
  );

  const ultimaComNok: Record<string, BlitzUltimaComNok> = Object.fromEntries(
    ((ultimaComNokRes ?? []) as unknown as {
      user_id: string; occurred_on: string; liberado: boolean; educativa: boolean; motivo: string | null;
      nao: { pergunta_id: string | null; pergunta: string }[];
    }[]).map((x) => [x.user_id, {
      dia: x.occurred_on, liberado: x.liberado, educativa: x.educativa === true, motivo: x.motivo,
      itens: x.nao.map((n) => ({ perguntaId: n.pergunta_id, pergunta: n.pergunta })),
    }]),
  );

  return (
    <div>
      <SegBlitzManager
        jaPassaram={jaPassaram}
        ultimaComNok={ultimaComNok}
        regras={regrasDaLinha(regrasLinha)}
        educativaPara={(educativaParaRes ?? []) as unknown as string[]}
        // corrige: avaliador da blitz, equipe de segurança e administração; Gestor e
        // Gerencial não (LUIZ, 18/11/2026). O banco confere de novo
        podeCorrigir={isAvaliadorBlitz || role === "owner" || role === "admin" || daSeguranca === true}
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
