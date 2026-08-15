import { requireContext, getMembers, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { moduleGate } from "@/lib/module-gate";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegRelatosManager, type RelatoRow } from "@/components/SegRelatosManager";

/**
 * Relatos de segurança.
 *
 * Duas telas na mesma rota, e a diferença não é cosmética:
 *
 *  - a operação inteira relata e vê APENAS os próprios relatos, para acompanhar
 *    o desfecho do que apontou;
 *  - a equipe de segurança (mais owner/admin) vê a fila completa, com o nome de
 *    quem relatou, porque alguém precisa poder voltar e perguntar.
 *
 * Quem decide isso é a RLS (`pode_ver_relato`), não esta página: a consulta é a
 * mesma para todo mundo e volta recortada. O que a página faz é ajustar o texto
 * e mostrar a triagem só a quem pode triar, para ninguém encarar um botão que
 * vai receber "não autorizado".
 */
export default async function SegurancaRelatosPage() {
  const gate = await moduleGate("seg_relatos");
  if (gate) return gate;

  // o papel não entra na conta: quem trata é a equipe de segurança mais
  // owner/admin, e quem responde isso é a função `pode_tratar_seguranca`
  const { tenant, user, unitScope } = await requireContext();
  const supabase = await createClient();

  const unidades = effectiveUnitFilter(unitScope);
  let lista = supabase
    .from("seg_relatos")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  // relato sem unidade continua aparecendo em qualquer recorte, mesma razão de
  // /acoes e /punicoes: sumir sem aviso é pior que aparecer demais
  if (unidades) lista = lista.or(`unit_id.in.(${unidades.join(",")}),unit_id.is.null`);

  const [
    { data: relatos }, { data: souSeguranca }, membros,
    { data: tipos }, { data: locais }, { data: areas }, { data: units },
  ] = await Promise.all([
    lista,
    supabase.rpc("pode_tratar_seguranca", { p_tenant: tenant.id }),
    getMembers(tenant.id),
    supabase.from("seg_tipos_relato").select("id, name, natureza, description, image_path, active")
      .eq("tenant_id", tenant.id).order("sort").order("name"),
    supabase.from("seg_locais").select("id, name, image_path, active")
      .eq("tenant_id", tenant.id).order("sort").order("name"),
    supabase.from("seg_areas").select("id, name, local_id, image_path, active")
      .eq("tenant_id", tenant.id).order("sort").order("name"),
    supabase.from("units").select("id, name").eq("tenant_id", tenant.id).order("name"),
  ]);

  const ehSeguranca = souSeguranca === true;
  const ids = (relatos ?? []).map((r) => r.id);

  // Envolvidos só são buscados quando há relato: a RLS já recorta pelo pai, mas
  // uma consulta a menos é uma consulta a menos.
  const { data: envolvidos } = ids.length
    ? await supabase
        .from("seg_relato_envolvidos")
        .select("relato_id, user_id, snap_full_name, snap_department_id, snap_department_name, snap_subdepartment_id, snap_subdepartment_name, snap_position_name, snap_manager_id, snap_manager_name, snap_unit_name")
        .in("relato_id", ids)
    : { data: [] };

  const porRelato = new Map<string, RelatoRow["envolvidos"]>();
  for (const e of envolvidos ?? []) {
    const atual = porRelato.get(e.relato_id) ?? [];
    atual.push({
      userId: e.user_id,
      nome: e.snap_full_name,
      setorId: e.snap_department_id,
      setor: e.snap_department_name,
      subsetorId: e.snap_subdepartment_id,
      subsetor: e.snap_subdepartment_name,
      funcao: e.snap_position_name,
      gestorId: e.snap_manager_id,
      gestor: e.snap_manager_name,
      unidade: e.snap_unit_name,
    });
    porRelato.set(e.relato_id, atual);
  }

  // `profile` vem nulo quando o vínculo aponta para um usuário já removido
  const pessoas = membros
    .map((m) => m.profile)
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ id: p.id, name: p.full_name ?? p.email ?? "—" }));
  const nomeDoUser = new Map(pessoas.map((p) => [p.id, p.name]));

  const rows: RelatoRow[] = (relatos ?? []).map((r) => ({
    id: r.id,
    occurredOn: r.occurred_on,
    tipoId: r.tipo_id,
    natureza: r.snap_natureza,
    localId: r.local_id,
    areaId: r.area_id,
    unitId: r.unit_id,
    descricao: r.descricao,
    status: r.status,
    notaTriagem: r.nota_triagem,
    triadoEm: r.triado_em,
    triadoPor: r.triado_por ? nomeDoUser.get(r.triado_por) ?? null : null,
    // o nome do relator só é montado para quem pode tratar. Para o próprio
    // relator o campo é dispensável (a tela dele já é "meus relatos"), e não
    // mandar o nome ao navegador de mais ninguém é a última camada do anonimato.
    relator: ehSeguranca ? nomeDoUser.get(r.created_by) ?? null : null,
    souAutor: r.created_by === user.id,
    criadoEm: r.created_at,
    envolvidos: porRelato.get(r.id) ?? [],
  }));

  return (
    <div>
      <PageHeader
        title="Relatos"
        subtitle={
          ehSeguranca
            ? "Fila de relatos da operação: tria, valida e encaminha o tratamento."
            : "Aponte um risco que você viu. Quem relata não aparece para o gestor nem para quem foi citado."
        }
      />
      <SegRelatosManager
        rows={rows}
        ehSeguranca={ehSeguranca}
        pessoas={pessoas}
        tipos={(tipos ?? []).map((t) => ({
          id: t.id, name: t.name, natureza: t.natureza,
          description: t.description, imagePath: t.image_path, active: t.active,
        }))}
        locais={(locais ?? []).map((l) => ({ id: l.id, name: l.name, imagePath: l.image_path, active: l.active }))}
        areas={(areas ?? []).map((a) => ({
          id: a.id, name: a.name, localId: a.local_id, imagePath: a.image_path, active: a.active,
        }))}
        unidades={(units ?? []).map((u) => ({ id: u.id, name: u.name }))}
      />
    </div>
  );
}
