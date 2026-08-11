"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { isValidCpf, onlyDigits } from "@/lib/cpf";
import type { ActionState } from "./types";

function buildData(formData: FormData, cpf: string) {
  return {
    full_name: String(formData.get("full_name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    cpf,
    phone: String(formData.get("phone") ?? "").trim(),
    birth_date: String(formData.get("birth_date") ?? ""),
    gender: String(formData.get("gender") ?? ""),
    employee_code: String(formData.get("employee_code") ?? "").trim(),
    admission_date: String(formData.get("admission_date") ?? ""),
    department_id: String(formData.get("department_id") ?? ""),
    subdepartment_id: String(formData.get("subdepartment_id") ?? ""),
    position_id: String(formData.get("position_id") ?? ""),
    position_level_id: String(formData.get("position_level_id") ?? ""),
    hierarchy_level_id: String(formData.get("hierarchy_level_id") ?? ""),
    manager_id: String(formData.get("manager_id") ?? ""),
    role: String(formData.get("role") ?? "member"),
    unit_ids: formData.getAll("unit_ids").map(String).filter(Boolean),
    // data de vigência da movimentação (só a edição envia; a criação ignora e
    // a primeira vigência nasce na admissão)
    effective_date: String(formData.get("effective_date") ?? ""),
  };
}

export async function createEmployee(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const cpf = onlyDigits(String(formData.get("cpf") ?? ""));
    if (!isValidCpf(cpf)) return { error: "CPF inválido. Confira os números." };
    if (!String(formData.get("employee_code") ?? "").trim()) return { error: "Informe a matrícula do colaborador." };
    const password = String(formData.get("password") ?? "");
    if (password.length < 8) return { error: "A senha deve ter ao menos 8 caracteres." };

    const { error } = await supabase.rpc("admin_create_employee", {
      p_data: buildData(formData, cpf),
      p_password: password,
    });
    if (error) return { error: error.message };

    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type ImportSummary = {
  created: number;
  /** recontratações: mesmo CPF com código de colaborador novo */
  updated: number;
  skipped: number;
  /**
   * colaboradores já cadastrados em que a planilha mexeu SÓ no gestor.
   * Conta separado de `updated` porque não é recontratação: nenhum outro campo
   * do cadastro foi tocado.
   */
  managers: number;
  /** linhas que não alteraram nada: mesmo código, ou contrato anterior (histórico) */
  skippedList: { nome: string; cpf: string; codigo: string | null; motivo?: string }[];
  updatedList: { nome: string; cpf: string; motivo: string }[];
  managersList: { nome: string; cpf: string; motivo: string }[];
  /** colaboradores em que a planilha mudou SÓ o perfil de acesso */
  roles: number;
  rolesList: { nome: string; cpf: string; motivo: string }[];
  /** colaboradores em que a planilha mudou SÓ a hierarquia */
  hierarchies: number;
  hierarchiesList: { nome: string; cpf: string; motivo: string }[];
  errors: { nome?: string; cpf?: string; erro: string }[];
};

const EMPTY_SUMMARY: ImportSummary = {
  created: 0, updated: 0, skipped: 0, managers: 0, roles: 0, hierarchies: 0,
  skippedList: [], updatedList: [], managersList: [], rolesList: [], hierarchiesList: [], errors: [],
};

export async function importEmployees(
  rows: Record<string, string>[],
  password: string,
): Promise<ImportSummary> {
  try {
    const { supabase } = await actionContext();
    if (!password || password.length < 8) {
      return { ...EMPTY_SUMMARY, errors: [{ erro: "Senha padrão mínima de 8 caracteres." }] };
    }
    const { data, error } = await supabase.rpc("admin_import_employees", {
      p_rows: rows as unknown as never,
      p_password: password,
    });
    if (error) return { ...EMPTY_SUMMARY, errors: [{ erro: error.message }] };
    revalidatePath("/configuracoes");
    return { ...EMPTY_SUMMARY, ...(data as unknown as ImportSummary) };
  } catch (e) {
    return { ...EMPTY_SUMMARY, errors: [{ erro: (e as Error).message }] };
  }
}

export async function updateEmployee(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const userId = String(formData.get("user_id") ?? "");
    if (!userId) return { error: "Usuário inválido." };
    const cpf = onlyDigits(String(formData.get("cpf") ?? ""));
    if (!isValidCpf(cpf)) return { error: "CPF inválido. Confira os números." };
    if (!String(formData.get("employee_code") ?? "").trim()) return { error: "Informe a matrícula do colaborador." };

    const { error } = await supabase.rpc("admin_update_employee", {
      p_user: userId,
      p_data: buildData(formData, cpf),
    });
    if (error) return { error: error.message };

    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Contrato encerrado do colaborador (vínculo anterior, com outro código). */
export type ContractHistoryItem = {
  employee_code: string | null;
  admission_date: string | null;
  dismissed_at: string | null;
  departamento: string | null;
  subsetor: string | null;
  funcao: string | null;
  perfil: string | null;
};

export type MovementHistoryItem = {
  effective_from: string;
  effective_to: string | null;
  source: "backfill" | "trigger";
  employee_code: string | null;
  is_active: boolean;
  dismissed_at: string | null;
  setor: string | null;
  subsetor: string | null;
  funcao: string | null;
  nivel: string | null;
  hierarquia: string | null;
  perfil: string;
  gestor: string | null;
  unidades: string[];
  alterado_por: string | null;
};

/**
 * Linha do tempo de movimentações do vínculo (setor, gestor, unidade, função…),
 * uma linha por vigência, da mais recente para a mais antiga. A guarda mora na
 * RPC: administração, RH, cadeia de gestão e a própria pessoa.
 */
export async function getMovementHistory(userId: string): Promise<MovementHistoryItem[]> {
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.rpc("employee_movement_history", { p_user: userId });
    if (error) return [];
    return (data ?? []) as unknown as MovementHistoryItem[];
  } catch {
    return [];
  }
}

/** Histórico de contratos anteriores, para a ficha do colaborador. */
export async function getContractHistory(userId: string): Promise<ContractHistoryItem[]> {
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.rpc("employee_contract_history", { p_user: userId });
    if (error) return [];
    return (data ?? []) as unknown as ContractHistoryItem[];
  } catch {
    return [];
  }
}
