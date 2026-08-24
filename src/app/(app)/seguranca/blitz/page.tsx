import { requireContext, getMembers, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { moduleGate } from "@/lib/module-gate";
import { SegBlitzManager, type BlitzPainel, type BlitzRow } from "@/components/SegBlitzManager";
import { getBlitzAlertas } from "@/lib/actions/seguranca";

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

  const { tenant, unitScope, role } = await requireContext();
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
    { data: painel }, alertas,
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
    supabase.from("seg_veiculos").select("user_id, meio_id, placa, tipo_descricao, propriedade, updated_at")
      .eq("tenant_id", tenant.id).eq("active", true).order("updated_at", { ascending: false }),
    // painel do ano corrente, com a recorrência já recortada pela alçada
    supabase.rpc("seg_blitz_painel", {
      p_ano: new Date().getFullYear(),
      p_unit_ids: unidades,
    }),
    // os alertas do usuário logado como gestor
    getBlitzAlertas(),
  ]);

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

  const pessoas = membros
    .map((m) => m.profile)
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ id: p.id, name: p.full_name ?? p.email ?? "—" }));
  const nomeDoUser = new Map(pessoas.map((p) => [p.id, p.name]));
  const nomeMotivo = new Map((motivos ?? []).map((m) => [m.id, m.name]));

  // um veículo por colaborador: o mais recente (a query já vem ordenada)
  const veiculoPorUser = new Map<string, NonNullable<typeof veiculos>[number]>();
  for (const v of veiculos ?? []) {
    if (!veiculoPorUser.has(v.user_id)) veiculoPorUser.set(v.user_id, v);
  }

  const rows: BlitzRow[] = (blitzes ?? []).map((b) => ({
    id: b.id,
    occurredOn: b.occurred_on,
    userId: b.user_id,
    pessoa: b.snap_full_name,
    setor: b.snap_department_name,
    gestor: b.snap_manager_name,
    unidade: b.snap_unit_name,
    meioId: b.meio_id,
    placa: b.placa,
    veiculoTipo: b.veiculo_tipo,
    propriedade: b.propriedade,
    liberado: b.liberado,
    motivoNome: b.motivo_bloqueio_id ? nomeMotivo.get(b.motivo_bloqueio_id) ?? null : null,
    observacao: b.observacao,
    conforme: b.conforme,
    avaliador: nomeDoUser.get(b.created_by) ?? null,
    respostas: respostasPorBlitz.get(b.id) ?? [],
  }));

  return (
    <div>
      <SegBlitzManager
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
          tipoDescricao: v.tipo_descricao, propriedade: v.propriedade,
        }))}
        painel={(painel ?? null) as BlitzPainel | null}
        alertas={alertas}
      />
    </div>
  );
}
