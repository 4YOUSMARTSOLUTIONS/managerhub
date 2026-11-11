"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { isValidCpf, onlyDigits } from "@/lib/cpf";
import type { ActionState } from "./types";
import { SEM_GESTOR } from "@/lib/constants";

// "Sem gestor" é uma escolha (chega como marcador); em branco é esquecimento
const GESTOR_EM_BRANCO = "Escolha o gestor, ou \"Sem gestor\" para quem está no topo da hierarquia.";

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
    // "Sem gestor" é uma opção do formulário, e chega aqui como marcador: a RPC
    // recebe vazio e grava nulo (`nullif(..., '')`), que é como o topo da
    // hierarquia sempre foi representado
    manager_id: (() => { const v = String(formData.get("manager_id") ?? ""); return v === SEM_GESTOR ? "" : v; })(),
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
    if (!String(formData.get("manager_id") ?? "")) return { error: GESTOR_EM_BRANCO };
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
  /** colaboradores já cadastrados em que a planilha mudou o nível do cargo ("Perfil Função") */
  levels: number;
  levelsList: { nome: string; cpf: string; motivo: string }[];
  /**
   * trocas de valor que já existia (função, nível, setor, subsetor, gestor,
   * hierarquia): cada uma abre uma vigência no histórico na data informada
   */
  movimentacoes: number;
  movimentacoesList: { nome: string; cpf: string; motivo: string }[];
  /** cadastros em que a planilha só completou campo vazio (sem data, sem vigência nova) */
  preenchimentos: number;
  /** só na prévia: quem tem movimentação e precisa de data antes de importar */
  pendentes: PendenteImportacao[];
  /** admissões corrigidas (as marcadas na prévia, ou vazias preenchidas) */
  admissoes: number;
  admissoesList: { nome: string; cpf: string; motivo: string }[];
  /** só na prévia: admissão da planilha diferente da cadastrada */
  admissoesDivergentes: AdmissaoDivergente[];
  errors: { nome?: string; cpf?: string; erro: string }[];
};

export type AdmissaoDivergente = {
  cpf: string;
  nome: string;
  matricula: string | null;
  /** AAAA-MM-DD */
  atual: string;
  /** AAAA-MM-DD */
  planilha: string;
};

export type MudancaImportacao = { campo: string; de: string | null; para: string | null };

export type PendenteImportacao = {
  /** só dígitos, a chave para devolver a data à linha da planilha */
  cpf: string;
  nome: string;
  matricula: string | null;
  unidade: string;
  /** início da situação atual (AAAA-MM-DD): a data da mudança não pode ser anterior */
  desde: string | null;
  mudancas: MudancaImportacao[];
};

const EMPTY_SUMMARY: ImportSummary = {
  created: 0, updated: 0, skipped: 0, managers: 0, roles: 0, hierarchies: 0, levels: 0,
  movimentacoes: 0, preenchimentos: 0, admissoes: 0,
  skippedList: [], updatedList: [], managersList: [], rolesList: [], hierarchiesList: [], levelsList: [],
  movimentacoesList: [], pendentes: [], admissoesList: [], admissoesDivergentes: [], errors: [],
};

/**
 * Prévia da importação: o banco roda a planilha inteira e desfaz tudo no fim.
 * Serve para saber, ANTES de gravar, quem muda de função, nível, setor,
 * subsetor, gestor ou hierarquia, e pedir a data de cada mudança.
 */
export async function simularImportacao(rows: Record<string, string>[]): Promise<ImportSummary> {
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.rpc("admin_import_employees", {
      p_rows: rows as unknown as never,
      p_password: "",
      p_simular: true,
    });
    if (error) return { ...EMPTY_SUMMARY, errors: [{ erro: error.message }] };
    return { ...EMPTY_SUMMARY, ...(data as unknown as ImportSummary) };
  } catch (e) {
    return { ...EMPTY_SUMMARY, errors: [{ erro: (e as Error).message }] };
  }
}

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
    const { supabase, tenantId, role } = await actionContext();
    const userId = String(formData.get("user_id") ?? "");
    if (!userId) return { error: "Usuário inválido." };
    const cpf = onlyDigits(String(formData.get("cpf") ?? ""));
    if (!isValidCpf(cpf)) return { error: "CPF inválido. Confira os números." };
    if (!String(formData.get("employee_code") ?? "").trim()) return { error: "Informe a matrícula do colaborador." };
    if (!String(formData.get("manager_id") ?? "")) return { error: GESTOR_EM_BRANCO };

    // Desligamento: conferido ANTES de salvar a ficha, para um erro na data não
    // deixar metade gravada (a ficha e a demissão são duas chamadas). O banco
    // confere tudo de novo em `colaborador_definir_desligamento`.
    const temDesligamento = formData.get("desligamento_presente") === "1";
    const desligamento = String(formData.get("dismissed_at") ?? "").trim() || null;
    if (temDesligamento && desligamento) {
      const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
      const admissao = String(formData.get("admission_date") ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desligamento)) return { error: "Data de desligamento inválida." };
      if (desligamento > hoje) return { error: "A data de desligamento não pode ser futura: lance no dia em que o desligamento acontecer." };
      if (admissao && desligamento < admissao) return { error: "A data de desligamento não pode ser antes da admissão." };
    }

    // Sem o campo de perfil na ficha (o RH vê o campo travado, que não é
    // enviado), o perfil fica como está: vai vazio e a RPC mantém o atual. Antes
    // ia "member", e salvar a ficha de um Gestor ou Gerencial pelo RH tentava
    // rebaixar a pessoa; a trava do banco recusava a ficha inteira, inclusive a
    // troca de gestor (LUIZ, 11/11/2026: Livia e Maria Eduarda).
    const dados = buildData(formData, cpf);
    const { error } = await supabase.rpc("admin_update_employee", {
      p_user: userId,
      p_data: formData.has("role") ? dados : { ...dados, role: "" },
    });
    if (error) return { error: error.message };

    if (temDesligamento) {
      const { error: eDeslig } = await supabase.rpc("colaborador_definir_desligamento", {
        p_tenant: tenantId, p_user: userId, p_data: desligamento,
      });
      if (eDeslig) return { error: `A ficha foi salva, mas o desligamento não: ${eDeslig.message}` };
    }

    // A marca de gestão de treinamentos vai à parte, e só quando o campo estava
    // na tela (o marcador distingue "desmarcado" de "não exibido"): o RH salva
    // a mesma ficha sem ver a caixa, e sem o marcador apagaria a marca de todo
    // mundo que ele editasse. Quem concede é owner/admin; a trava do banco
    // (`so_administracao_concede_treinamentos`) vale também fora desta tela.
    // A marca de RH vai junto, pelo mesmo marcador e com a mesma trava no banco
    // (`so_administracao_concede_rh`).
    if (formData.get("gestao_treinamentos_presente") === "1" && (role === "owner" || role === "admin")) {
      const { error: e2 } = await supabase
        .from("memberships")
        .update({
          is_training_manager: formData.get("is_training_manager") === "1",
          is_hr: formData.get("is_hr") === "1",
          // mesma trava no banco: só owner/admin concede (so_administracao_concede_avaliador_blitz)
          is_avaliador_blitz: formData.get("is_avaliador_blitz") === "1",
        })
        .eq("tenant_id", tenantId)
        .eq("user_id", userId);
      if (e2) return { error: e2.message };
    }

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
