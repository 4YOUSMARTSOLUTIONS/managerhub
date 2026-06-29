import type { Enums } from "@/types/database";

// ---------- Reuniões ----------
export const MEETING_STATUS: Record<Enums<"meeting_status">, string> = {
  scheduled: "Agendada",
  in_progress: "Em andamento",
  done: "Concluída",
  cancelled: "Cancelada",
};

export const MEETING_STATUS_TONE: Record<Enums<"meeting_status">, Tone> = {
  scheduled: "blue",
  in_progress: "amber",
  done: "green",
  cancelled: "gray",
};

// ---------- Periodicidade de reuniões ----------
export const PERIODICITY: Record<Enums<"meeting_periodicity">, string> = {
  diaria: "Diária",
  semanal: "Semanal",
  quinzenal: "Quinzenal",
  mensal: "Mensal",
  bimestral: "Bimestral",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
  sob_demanda: "Sob demanda",
};

// ---------- Ações ----------
export const ACTION_STATUS: Record<Enums<"action_status">, string> = {
  open: "Aberta",
  in_progress: "Em andamento",
  blocked: "Bloqueada",
  done: "Concluída",
  cancelled: "Cancelada",
};

export const ACTION_STATUS_TONE: Record<Enums<"action_status">, Tone> = {
  open: "blue",
  in_progress: "amber",
  blocked: "red",
  done: "green",
  cancelled: "gray",
};

// ---------- Status efetivo da ação (exibido ao usuário) ----------
export type EffStatus = "concluida" | "cancelada" | "aguardando" | "atrasada" | "andamento";

export const EFF_STATUS_LABEL: Record<EffStatus, string> = {
  concluida: "Concluída",
  atrasada: "Atrasada",
  andamento: "Em andamento",
  aguardando: "Aguardando aprovação",
  cancelada: "Cancelada",
};

export const EFF_STATUS_TONE: Record<EffStatus, Tone> = {
  concluida: "green",
  atrasada: "red",
  andamento: "amber",
  aguardando: "blue",
  cancelada: "gray",
};

export function effStatus(status: Enums<"action_status">, overdue: boolean, pending: boolean): EffStatus {
  if (status === "cancelled") return "cancelada";
  if (status === "done") return "concluida";
  if (pending) return "aguardando";
  if (overdue) return "atrasada";
  return "andamento";
}

// ---------- Chamados ----------
export const TICKET_STATUS: Record<Enums<"ticket_status">, string> = {
  open: "Aberto",
  in_progress: "Em atendimento",
  waiting: "Aguardando",
  resolved: "Resolvido",
  closed: "Fechado",
  cancelled: "Cancelado",
};

export const TICKET_STATUS_TONE: Record<Enums<"ticket_status">, Tone> = {
  open: "blue",
  in_progress: "amber",
  waiting: "purple",
  resolved: "green",
  closed: "gray",
  cancelled: "gray",
};

export const TICKET_CATEGORY: Record<Enums<"ticket_category">, string> = {
  ti: "TI",
  servicos_gerais: "Serviços Gerais",
  facilities: "Facilities",
  rh: "RH",
  financeiro: "Financeiro",
  outros: "Outros",
};

// ---------- Metas ----------
export const GOAL_STATUS: Record<Enums<"goal_status">, string> = {
  active: "Ativa",
  at_risk: "Em risco",
  achieved: "Atingida",
  missed: "Não atingida",
  archived: "Arquivada",
};

export const GOAL_STATUS_TONE: Record<Enums<"goal_status">, Tone> = {
  active: "blue",
  at_risk: "amber",
  achieved: "green",
  missed: "red",
  archived: "gray",
};

// ---------- Prioridade ----------
export const PRIORITY: Record<Enums<"priority_level">, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

export const PRIORITY_TONE: Record<Enums<"priority_level">, Tone> = {
  low: "gray",
  medium: "blue",
  high: "amber",
  urgent: "red",
};

// ---------- Status da empresa ----------
export const TENANT_STATUS: Record<Enums<"tenant_status">, string> = {
  active: "Ativa",
  suspended: "Suspensa",
  inactive: "Desativada",
};

export const TENANT_STATUS_TONE: Record<Enums<"tenant_status">, Tone> = {
  active: "green",
  suspended: "amber",
  inactive: "red",
};

// ---------- Papéis ----------
export const ROLE: Record<Enums<"member_role">, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  manager: "Gestor",
  member: "Membro",
};

// ---------- Sexo ----------
export const GENDER: Record<Enums<"gender_type">, string> = {
  masculino: "Masculino",
  feminino: "Feminino",
  outro: "Outro",
  nao_informado: "Não informar",
};

// ---------- Tipo de unidade ----------
export const UNIT_KIND: Record<Enums<"unit_kind">, string> = {
  matriz: "Matriz",
  filial: "Filial",
};

// ---------- Tipo de usuário (subconjunto de papéis para cadastro) ----------
export const USER_TYPE: Partial<Record<Enums<"member_role">, string>> = {
  admin: "Administrador",
  manager: "Gerencial",
  member: "Funcionário",
};

export type Tone =
  | "blue"
  | "green"
  | "amber"
  | "red"
  | "gray"
  | "purple";

// helper para transformar enum -> [{value,label}]
export function options<T extends string>(map: Record<T, string>) {
  return (Object.entries(map) as [T, string][]).map(([value, label]) => ({
    value,
    label,
  }));
}
