"use server";

import { actionContext } from "./context";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { minhaEquipe } from "@/lib/team";
import {
  linhaDaPlanilhaDeColaboradores, ordemPorMatricula, type LinhaColaborador,
} from "@/lib/planilha-colaboradores";

/**
 * A planilha de colaboradores da EQUIPE de quem exporta (a cadeia inteira de
 * "Minha equipe"), no mesmo formato da exportação de Configurações >
 * Colaboradores. Só exportação: importar continua com o DP.
 *
 * Os dados pessoais (CPF, telefone, nascimento, sexo) vêm de
 * `equipe_dados_pessoais`, que só entrega quem está na cadeia de quem chama
 * (decisão do LUIZ, 04/11/2026). Sai no clique, e não junto da página, para o
 * dado pessoal não ficar embutido no HTML de quem só abriu a tela.
 */
export async function planilhaDaEquipe(): Promise<{ linhas: string[][]; error?: undefined } | { error: string }> {
  try {
    const { supabase, tenantId, role } = await actionContext();
    if (role !== "owner" && role !== "admin" && role !== "manager" && role !== "team_lead") {
      return { error: "Apenas quem tem perfil de Gestor ou superior exporta a equipe." };
    }

    const equipe = new Set(await minhaEquipe(supabase, tenantId));
    if (equipe.size === 0) return { linhas: [] };

    // A empresa passa de 1000 vínculos: sem `fetchAll` o PostgREST corta calado,
    // e quem ficasse de fora sumiria da planilha (e o gestor dele, do código).
    const [
      { data: vinculos }, { data: vinculoUnidade }, { data: unidades }, { data: deps }, { data: subs },
      { data: cargos }, { data: niveis }, { data: hierarquias }, { data: perfis }, { data: pessoais, error: erroPessoais },
    ] = await Promise.all([
      fetchAll(() => supabase
        .from("memberships")
        .select("id, user_id, employee_code, admission_date, dismissed_at, role, manager_id, department_id, subdepartment_id, position_id, position_level_id, hierarchy_level_id")
        .eq("tenant_id", tenantId)
        .order("id")),
      fetchAll(() => supabase.from("membership_units").select("membership_id, unit_id").order("membership_id").order("unit_id")),
      supabase.from("units").select("id, name").eq("tenant_id", tenantId),
      supabase.from("departments").select("id, name").eq("tenant_id", tenantId),
      supabase.from("subdepartments").select("id, name").eq("tenant_id", tenantId),
      supabase.from("positions").select("id, name").eq("tenant_id", tenantId),
      supabase.from("position_levels").select("id, name").eq("tenant_id", tenantId),
      supabase.from("hierarchy_levels").select("id, name").eq("tenant_id", tenantId),
      // só as colunas que `authenticated` lê (ver AGENTS.md); o resto vem da RPC
      fetchAll(() => supabase.from("profiles").select("id, full_name, email").order("id")),
      supabase.rpc("equipe_dados_pessoais", { p_tenant: tenantId }),
    ]);
    if (erroPessoais) return { error: erroPessoais.message };

    const nomeUnidade = new Map((unidades ?? []).map((u) => [u.id, u.name]));
    const unidadesDoVinculo = new Map<string, string[]>();
    for (const v of vinculoUnidade ?? []) {
      const nm = nomeUnidade.get(v.unit_id);
      if (!nm) continue;
      const arr = unidadesDoVinculo.get(v.membership_id) ?? [];
      arr.push(nm);
      unidadesDoVinculo.set(v.membership_id, arr);
    }
    const nome = (lista: { id: string; name: string }[] | null) => new Map((lista ?? []).map((x) => [x.id, x.name]));
    const setor = nome(deps); const subsetor = nome(subs); const cargo = nome(cargos);
    const nivel = nome(niveis); const hierarquia = nome(hierarquias);
    const perfil = new Map((perfis ?? []).map((p) => [p.id, p]));
    const pessoal = new Map((pessoais ?? []).map((p) => [p.id, p]));
    const codigoPorUser = new Map((vinculos ?? []).map((v) => [v.user_id, v.employee_code]));

    const linhas: LinhaColaborador[] = (vinculos ?? [])
      .filter((v) => equipe.has(v.user_id))
      .map((v) => {
        const d = pessoal.get(v.user_id);
        return {
          unitNames: unidadesDoVinculo.get(v.id) ?? [],
          employeeCode: v.employee_code,
          fullName: perfil.get(v.user_id)?.full_name ?? null,
          admissionDate: v.admission_date,
          positionName: v.position_id ? cargo.get(v.position_id) ?? null : null,
          levelName: v.position_level_id ? nivel.get(v.position_level_id) ?? null : null,
          departmentName: v.department_id ? setor.get(v.department_id) ?? null : null,
          subdepartmentName: v.subdepartment_id ? subsetor.get(v.subdepartment_id) ?? null : null,
          birthDate: d?.birth_date ?? null,
          cpf: d?.cpf ?? null,
          dismissedAt: v.dismissed_at,
          gender: d?.gender ?? null,
          phone: d?.phone ?? null,
          email: perfil.get(v.user_id)?.email ?? null,
          managerCode: v.manager_id ? codigoPorUser.get(v.manager_id) ?? null : null,
          role: v.role,
          hierarchyName: v.hierarchy_level_id ? hierarquia.get(v.hierarchy_level_id) ?? null : null,
        };
      });

    return { linhas: linhas.sort(ordemPorMatricula).map(linhaDaPlanilhaDeColaboradores) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
