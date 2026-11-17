import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Origem } from "@/lib/import-pessoa";
import { fetchAll } from "@/lib/supabase/fetch-all";

/**
 * O cadastro inteiro (ativos, desligados e contratos anteriores) no formato do
 * resolvedor de `import-pessoa.ts`. Usado pelas importações de absenteísmo
 * (histórico e comunicados), que identificam a pessoa por ID + Unidade.
 *
 * Mora fora dos arquivos de actions de propósito: lá toda função exportada vira
 * endpoint chamável pelo navegador.
 */
export async function carregarCadastroParaImportar(supabase: SupabaseClient<Database>, tenantId: string) {
  const [{ data: membros }, { data: unidades }, { data: vinculoUnidade }, { data: contratos }] = await Promise.all([
    fetchAll(() => supabase
      .from("memberships")
      .select("id, user_id, is_active, employee_code, profiles!memberships_user_id_fkey(full_name)")
      .eq("tenant_id", tenantId)
      .order("id")),
    supabase.from("units").select("id, name").eq("tenant_id", tenantId),
    // RLS já limita ao tenant; .in() com centenas de ids estouraria a URL
    fetchAll(() => supabase.from("membership_units").select("membership_id, unit_id").order("membership_id").order("unit_id")),
    supabase.from("employee_contracts").select("user_id, employee_code").eq("tenant_id", tenantId),
  ]);

  const nomeUnidade = new Map((unidades ?? []).map((u) => [u.id, u.name]));
  const unidadesDoVinculo = new Map<string, string[]>();
  for (const v of vinculoUnidade ?? []) {
    const nm = nomeUnidade.get(v.unit_id);
    if (!nm) continue;
    const arr = unidadesDoVinculo.get(v.membership_id) ?? [];
    arr.push(nm);
    unidadesDoVinculo.set(v.membership_id, arr);
  }

  const nomePorUser = new Map<string, string>();
  for (const m of membros ?? []) {
    const nome = (m.profiles as unknown as { full_name: string | null } | null)?.full_name;
    if (nome) nomePorUser.set(m.user_id, nome);
  }

  // Histórico de quem já saiu, ou de um contrato ANTERIOR da mesma pessoa (a
  // matrícula muda na recontratação), é justamente o caso destas importações.
  const unidadesPorUser = new Map<string, string[]>();
  const refs: { id: string; code?: string | null; units?: string[]; origem?: Origem }[] = [];
  for (const m of membros ?? []) {
    const uns = unidadesDoVinculo.get(m.id) ?? [];
    unidadesPorUser.set(m.user_id, uns);
    refs.push({ id: m.user_id, code: m.employee_code, units: uns, origem: m.is_active ? "ativo" : "desligado" });
  }
  for (const c of contratos ?? []) {
    refs.push({ id: c.user_id, code: c.employee_code, units: unidadesPorUser.get(c.user_id) ?? [], origem: "contrato_anterior" });
  }

  return { refs, unidades: unidades ?? [], nomePorUser };
}
