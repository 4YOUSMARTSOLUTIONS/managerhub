/**
 * Leitura das regras de acesso às telas, do lado do servidor (página de
 * Configurações e ação da ficha). Sem "use server": não é endpoint.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type RegrasDeAcesso = {
  /** nível → telas liberadas (nível ausente = sem restrição) */
  niveis: Map<string, string[]>;
  /** pessoa → exceção */
  pessoas: Map<string, { livre: boolean; telas: string[]; em: string }>;
  /** módulos contratados em alguma unidade da empresa */
  contratadas: Set<string>;
};

export async function lerRegrasDeAcesso(supabase: SupabaseClient<Database>, tenantId: string): Promise<RegrasDeAcesso> {
  const [{ data: regras, error }, { data: contratos }] = await Promise.all([
    supabase.rpc("acesso_telas_listar", { p_tenant: tenantId }),
    supabase.from("unit_modules").select("module_key").eq("tenant_id", tenantId).eq("state", "on"),
  ]);
  if (error) throw new Error(error.message);
  const r = (regras ?? {}) as {
    niveis?: { nivel: string; modulos: string[] }[];
    pessoas?: { user: string; livre: boolean; modulos: string[]; em: string }[];
  };
  return {
    niveis: new Map((r.niveis ?? []).map((n) => [n.nivel, n.modulos])),
    pessoas: new Map((r.pessoas ?? []).map((p) => [p.user, { livre: p.livre, telas: p.modulos, em: p.em }])),
    contratadas: new Set((contratos ?? []).map((c) => c.module_key)),
  };
}

export type RegrasDeSessao = { padrao: number | null; niveis: Map<string, number> };

/** Tempo sem uso: padrão da empresa (8 h sem configuração) e o de cada nível. */
export async function lerRegrasDeSessao(supabase: SupabaseClient<Database>, tenantId: string): Promise<RegrasDeSessao> {
  const { data, error } = await supabase.rpc("sessao_listar", { p_tenant: tenantId });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as { padrao?: number | null; niveis?: { nivel: string; minutos: number }[] };
  return {
    padrao: typeof r.padrao === "number" ? r.padrao : null,
    niveis: new Map((r.niveis ?? []).map((n) => [n.nivel, n.minutos])),
  };
}

/** Proprietário, administrador e RH nunca são restringidos (mesma regra de `minhas_telas`). */
export function isentoDoAcesso(role: string, isHr: boolean): string | null {
  if (role === "owner") return "Proprietário";
  if (role === "admin") return "Administrador";
  if (isHr) return "RH";
  return null;
}
