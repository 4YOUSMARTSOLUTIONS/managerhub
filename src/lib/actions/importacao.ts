"use server";

/**
 * Regras e parâmetros da importação de colaboradores (LUIZ, 26/11/2026).
 *
 * Tudo aqui é do departamento pessoal (`dpActionContext`): as regras substituem
 * as abas que o DP mantinha à mão na planilha de importação. São SUGESTÕES que
 * a tela de importação mostra; quem importa confirma cada uma.
 */

import { revalidatePath } from "next/cache";
import { dpActionContext } from "./context";
import type { ActionState } from "./types";

const dominioValido = (d: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(d);

/** Códigos de empresa do Domínio → unidade, e os domínios do e-mail corporativo. */
export async function salvarConfigImportacao(input: {
  empresasDominio: Record<string, string>;
  dominiosEmail: string[];
}): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await dpActionContext();

    const empresas: Record<string, string> = {};
    for (const [codigo, unidade] of Object.entries(input.empresasDominio)) {
      const c = codigo.trim().replace(/^0+(?=\d)/, "");
      const u = unidade.trim();
      if (!c && !u) continue;
      if (!/^\d+$/.test(c)) return { error: `O código de empresa "${codigo}" precisa ser um número.` };
      if (!u) return { error: `Escolha a unidade do código ${c}.` };
      if (empresas[c]) return { error: `O código ${c} aparece duas vezes.` };
      empresas[c] = u;
    }
    // a unidade precisa existir: nome errado faria a importação criar uma unidade nova
    const { data: unidades, error: eUn } = await supabase.from("units").select("name").eq("tenant_id", tenantId);
    if (eUn) return { error: eUn.message };
    const nomes = new Set((unidades ?? []).map((u) => u.name));
    const desconhecida = Object.values(empresas).find((u) => !nomes.has(u));
    if (desconhecida) return { error: `A unidade "${desconhecida}" não existe nesta empresa.` };

    const dominios = [...new Set(
      input.dominiosEmail.map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean),
    )];
    const ruim = dominios.find((d) => !dominioValido(d));
    if (ruim) return { error: `"${ruim}" não é um domínio de e-mail (exemplo: empresa.com.br).` };

    const { error } = await supabase.from("importacao_config").upsert(
      {
        tenant_id: tenantId,
        empresas_dominio: empresas,
        dominios_email_corporativo: dominios,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" },
    );
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    return { ok: true, message: "Parâmetros da importação salvos." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Hierarquia sugerida para uma função. `null` apaga a regra. */
export async function salvarRegraFuncao(positionId: string, hierarchyId: string | null): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await dpActionContext();
    const { error } = hierarchyId
      ? await supabase.from("regra_funcao_hierarquia").upsert(
        { tenant_id: tenantId, position_id: positionId, hierarchy_level_id: hierarchyId, updated_by: userId },
        { onConflict: "tenant_id,position_id" },
      )
      : await supabase.from("regra_funcao_hierarquia").delete().eq("tenant_id", tenantId).eq("position_id", positionId);
    if (error) return { error: error.message };
    // a importação, na mesma tela, precisa da regra nova
    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Gestor sugerido para um subsetor numa unidade. `null` apaga a regra. */
export async function salvarRegraSubsetor(
  subdepartmentId: string, unitId: string, managerId: string | null,
): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await dpActionContext();
    const { error } = managerId
      ? await supabase.from("regra_subsetor_gestor").upsert(
        { tenant_id: tenantId, subdepartment_id: subdepartmentId, unit_id: unitId, manager_id: managerId, updated_by: userId },
        { onConflict: "tenant_id,subdepartment_id,unit_id" },
      )
      : await supabase.from("regra_subsetor_gestor").delete()
        .eq("tenant_id", tenantId).eq("subdepartment_id", subdepartmentId).eq("unit_id", unitId);
    if (error) return { error: error.message };
    // a importação, na mesma tela, precisa da regra nova
    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const canonico = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/**
 * Depois da importação: guarda como regra o que o DP escolheu para função ou
 * subsetor que ainda não tinha regra ("lembrar para as próximas"). Só cria; a
 * regra que já existe não é trocada por aqui, e sim na tela de regras.
 *
 * A função vem pelo NOME porque pode ter nascido nesta importação (a RPC cria
 * o cargo que não existe).
 */
export async function lembrarRegras(input: {
  funcoes: { funcao: string; hierarchyId: string }[];
  subsetores: { subdepartmentId: string; unitName: string; managerId: string }[];
}): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await dpActionContext();
    let salvas = 0;

    if (input.funcoes.length > 0) {
      const { data: cargos, error } = await supabase.from("positions").select("id, name").eq("tenant_id", tenantId);
      if (error) return { error: error.message };
      const porNome = new Map((cargos ?? []).map((c) => [canonico(c.name), c.id]));
      const linhas = input.funcoes
        .map((f) => ({ position_id: porNome.get(canonico(f.funcao)), hierarchy_level_id: f.hierarchyId }))
        .filter((f): f is { position_id: string; hierarchy_level_id: string } => !!f.position_id)
        .map((f) => ({ ...f, tenant_id: tenantId, updated_by: userId }));
      if (linhas.length > 0) {
        const { error: e2, count } = await supabase.from("regra_funcao_hierarquia")
          .upsert(linhas, { onConflict: "tenant_id,position_id", ignoreDuplicates: true, count: "exact" });
        if (e2) return { error: e2.message };
        salvas += count ?? 0;
      }
    }

    if (input.subsetores.length > 0) {
      const { data: unidades, error } = await supabase.from("units").select("id, name").eq("tenant_id", tenantId);
      if (error) return { error: error.message };
      const porNome = new Map((unidades ?? []).map((u) => [canonico(u.name), u.id]));
      const linhas = input.subsetores
        .map((s) => ({ subdepartment_id: s.subdepartmentId, unit_id: porNome.get(canonico(s.unitName)), manager_id: s.managerId }))
        .filter((s): s is { subdepartment_id: string; unit_id: string; manager_id: string } => !!s.unit_id)
        .map((s) => ({ ...s, tenant_id: tenantId, updated_by: userId }));
      if (linhas.length > 0) {
        const { error: e2, count } = await supabase.from("regra_subsetor_gestor")
          .upsert(linhas, { onConflict: "tenant_id,subdepartment_id,unit_id", ignoreDuplicates: true, count: "exact" });
        if (e2) return { error: e2.message };
        salvas += count ?? 0;
      }
    }

    return { ok: true, message: salvas > 0 ? `${salvas} regra(s) nova(s) guardada(s) para as próximas importações.` : undefined };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
