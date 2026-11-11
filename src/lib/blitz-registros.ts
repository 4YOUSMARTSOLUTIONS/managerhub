import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { getMembers } from "@/lib/tenant";
import type { BlitzRow } from "@/components/SegBlitzManager";

/**
 * A lista de Registros da blitz, lida no servidor (LUIZ, 11/11/2026).
 *
 * Com período (`de`/`ate`), só as blitz daquelas datas; sem período, tudo que a
 * pessoa alcança. Paginado de 1000 em 1000 (`fetchAll`): o PostgREST corta em
 * 1000 sem avisar, e o antigo `.limit(500)` deixava o período anual sem as
 * blitz mais velhas. Quem decide o que cada um vê é a RLS (`pode_ver_blitz`).
 *
 * As respostas de cada blitz NÃO vêm aqui: são lidas quando a ficha abre
 * (`getBlitzRespostas`). Vinham todas juntas, e oito respostas por blitz
 * batiam no corte de 1000 com pouco mais de cem blitz.
 *
 * Módulo de servidor sem "use server": a página e a action chamam; não vira
 * endpoint público.
 */
export async function lerRegistrosDaBlitz(
  tenantId: string,
  opcoes: { de?: string; ate?: string; unidades: string[] | null },
): Promise<{ data: BlitzRow[]; error: null } | { data: null; error: string }> {
  const supabase = await createClient();
  const [lidas, membros, motivos] = await Promise.all([
    fetchAll(() => {
      let q = supabase
        .from("seg_blitz_avaliacoes")
        .select(
          "id, occurred_on, registrada_em, user_id, snap_full_name, snap_department_name, snap_manager_name, " +
          "snap_unit_name, snap_position_name, meio_id, placa, veiculo_tipo, propriedade, cor, liberado, " +
          "motivo_bloqueio_id, observacao, conforme, created_by",
        )
        .eq("tenant_id", tenantId);
      if (opcoes.de) q = q.gte("occurred_on", opcoes.de);
      if (opcoes.ate) q = q.lte("occurred_on", opcoes.ate);
      if (opcoes.unidades) q = q.or(`unit_id.in.(${opcoes.unidades.join(",")}),unit_id.is.null`);
      // ordem estável até o fim (o id desempata): sem isso a página 2 repete e pula linha
      return q.order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).order("id");
    }),
    getMembers(tenantId),
    supabase.from("seg_blitz_motivos").select("id, name").eq("tenant_id", tenantId),
  ]);
  if (lidas.error) return { data: null, error: lidas.error.message };

  const nomeDoUser = new Map<string, string>();
  const matriculaDo = new Map<string, string | null>();
  for (const m of membros) {
    if (!m.profile) continue;
    nomeDoUser.set(m.profile.id, m.profile.full_name ?? m.profile.email ?? "—");
    matriculaDo.set(m.profile.id, m.code);
  }
  const nomeMotivo = new Map((motivos.data ?? []).map((m) => [m.id, m.name]));

  // hora e dia do registro no fuso de São Paulo (o servidor roda em UTC)
  const diaSp = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
  const horaSp = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

  type Lida = {
    id: string; occurred_on: string; registrada_em: string; user_id: string; snap_full_name: string | null;
    snap_department_name: string | null; snap_manager_name: string | null; snap_unit_name: string | null;
    snap_position_name: string | null; meio_id: string; placa: string | null; veiculo_tipo: string | null;
    propriedade: BlitzRow["propriedade"]; cor: string | null; liberado: boolean; motivo_bloqueio_id: string | null;
    observacao: string | null; conforme: boolean; created_by: string;
  };
  const data = ((lidas.data ?? []) as unknown as Lida[]).map((b): BlitzRow => ({
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
  }));
  return { data, error: null };
}
