import { requireContext, getMembers, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { moduleGate } from "@/lib/module-gate";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegAcidentesManager, type AcidenteRow } from "@/components/SegAcidentesManager";
import { getItemDoPrograma } from "@/lib/actions/seguranca";

/**
 * Acidentes de trabalho.
 *
 * Tela fechada: quem entra é a equipe de segurança cadastrada, mais o
 * proprietário e o administrador. Não é rigor decorativo, é o conteúdo: a linha
 * tem CID, que é dado de saúde, e o mesmo raciocínio do atestado do
 * absenteísmo vale aqui.
 *
 * O recorte de verdade é da RLS; esta guarda existe para quem digitar a URL na
 * mão encontrar uma explicação em vez de uma lista vazia.
 */
export default async function SegurancaAcidentesPage() {
  const gate = await moduleGate("seg_acidentes");
  if (gate) return gate;

  const { tenant, unitScope, role } = await requireContext();
  const supabase = await createClient();

  const { data: pode } = await supabase.rpc("pode_tratar_seguranca", { p_tenant: tenant.id });
  if (pode !== true) {
    return (
      <div>
        <PageHeader title="Acidentes" />
        <EmptyState
          title="Acesso restrito"
          description="O registro de acidentes é da equipe de segurança do trabalho. Peça ao administrador para incluir você em Configurações, aba Segurança."
        />
      </div>
    );
  }

  const unidades = effectiveUnitFilter(unitScope);
  let lista = supabase
    .from("seg_acidentes")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("occurred_on", { ascending: false })
    .limit(500);
  if (unidades) lista = lista.or(`snap_unit_id.in.(${unidades.join(",")}),snap_unit_id.is.null`);

  // a lista de unidades saiu da carga: o formulário não pergunta mais a
  // unidade (ela vem do vínculo do acidentado) e o filtro é o do topo
  const [
    { data: acidentes }, membros, { data: locais }, { data: areas }, { data: causas },
    itemPrograma,
  ] = await Promise.all([
    lista,
    getMembers(tenant.id),
    supabase.from("seg_locais").select("id, name, active").eq("tenant_id", tenant.id).order("sort").order("name"),
    supabase.from("seg_areas").select("id, name, local_id, active").eq("tenant_id", tenant.id).order("sort").order("name"),
    supabase.from("seg_causas").select("id, name, active").eq("tenant_id", tenant.id).order("sort").order("name"),
    // a que item do Programa a ação de tratamento será amarrada (1.1)
    getItemDoPrograma("acidente"),
  ]);

  const ids = (acidentes ?? []).map((a) => a.id);
  const { data: anexos } = ids.length
    ? await supabase
        .from("seg_acidente_anexos")
        .select("id, acidente_id, filename, content_type, size")
        .in("acidente_id", ids)
        .order("created_at")
    : { data: [] };

  // ações de tratamento abertas a partir dos acidentes: elas vivem no módulo
  // de Ações, e aqui aparece só o ponteiro
  const { data: vinculos } = ids.length
    ? await supabase
        .from("seg_acidente_acoes")
        .select("acidente_id, action_id, actions(code, due_date, action_demandas(status))")
        .in("acidente_id", ids)
    : { data: [] };

  const acoesPorAcidente = new Map<string, AcidenteRow["acoes"]>();
  for (const v of vinculos ?? []) {
    const a = v.actions as unknown as {
      code: number; due_date: string | null; action_demandas: { status: string }[];
    } | null;
    if (!a) continue;
    const demandas = a.action_demandas ?? [];
    const atual = acoesPorAcidente.get(v.acidente_id) ?? [];
    atual.push({
      id: v.action_id,
      codigo: a.code,
      prazo: a.due_date,
      concluida: demandas.length > 0 && demandas.every((d) => d.status === "done"),
      pendentes: demandas.filter((d) => d.status !== "done").length,
    });
    acoesPorAcidente.set(v.acidente_id, atual);
  }

  const porAcidente = new Map<string, AcidenteRow["anexos"]>();
  for (const x of anexos ?? []) {
    const atual = porAcidente.get(x.acidente_id) ?? [];
    atual.push({ id: x.id, nome: x.filename, mime: x.content_type, tamanho: x.size });
    porAcidente.set(x.acidente_id, atual);
  }

  const pessoas = membros
    .map((m) => m.profile)
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ id: p.id, name: p.full_name ?? p.email ?? "—" }));
  const nomeDoUser = new Map(pessoas.map((p) => [p.id, p.name]));

  const rows: AcidenteRow[] = (acidentes ?? []).map((a) => ({
    id: a.id,
    userId: a.user_id,
    pessoa: a.snap_full_name,
    matricula: a.snap_employee_code,
    setor: a.snap_department_name,
    subsetor: a.snap_subdepartment_name,
    funcao: a.snap_position_name,
    gestor: a.snap_manager_name,
    setorId: a.snap_department_id,
    subsetorId: a.snap_subdepartment_id,
    gestorId: a.snap_manager_id,
    unidade: a.snap_unit_name,
    unitId: a.unit_id,
    occurredOn: a.occurred_on,
    occurredAt: a.occurred_at,
    turno: a.turno,
    classe: a.classe,
    tipo: a.tipo,
    status: a.status,
    localId: a.local_id,
    areaId: a.area_id,
    descricao: a.descricao,
    testemunhas: a.testemunhas,
    parteCorpo: a.parte_corpo,
    agenteCausador: a.agente_causador,
    naturezaLesao: a.natureza_lesao,
    analiseCausa: a.analise_causa,
    causaId: a.causa_id,
    catNumero: a.cat_numero,
    catEmitidaEm: a.cat_emitida_em,
    cidCode: a.cid_code,
    cidDescricao: a.cid_descricao,
    diasAfastamento: a.dias_afastamento,
    afastamentoDe: a.afastamento_de,
    retornoEm: a.retorno_em,
    // quando o caso entrou no sistema, e por quem. Com data retroativa
    // liberada, é isto que separa "aconteceu em março" de "foi lançado em agosto".
    criadoEm: a.created_at,
    criadoPor: nomeDoUser.get(a.created_by) ?? null,
    anexos: porAcidente.get(a.id) ?? [],
    acoes: acoesPorAcidente.get(a.id) ?? [],
  }));

  return (
    <div>
      <PageHeader
        title="Acidentes"
        subtitle="Registro dos acidentes de trabalho, com o que a empresa precisa e o que a lei pede."
      />
      <SegAcidentesManager
        ehProprietario={role === "owner"}
        rows={rows}
        pessoas={pessoas}
        locais={(locais ?? []).map((l) => ({ id: l.id, name: l.name, active: l.active }))}
        areas={(areas ?? []).map((a) => ({ id: a.id, name: a.name, localId: a.local_id, active: a.active }))}
        causas={(causas ?? []).map((c) => ({ id: c.id, name: c.name, active: c.active }))}
        itemPrograma={itemPrograma}
      />
    </div>
  );
}
