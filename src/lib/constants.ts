import type { Enums } from "@/types/database";
import { isOverdue } from "@/lib/format";

// tamanho de página dos registros de reunião ("Carregar mais")
export const OCC_PAGE_SIZE = 300;

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

/**
 * Status efetivo de UM responsável dentro da demanda (conclusão por pessoa).
 * Quem já concluiu (completedAt) ou já enviou a parte (doneRequestedAt) NÃO conta
 * como atrasada/andamento — só quem ainda não executou.
 */
export function assigneeEffStatus(
  a: { doneRequestedAt: string | null; completedAt: string | null },
  dueDate: string | null,
  cancelled: boolean,
): EffStatus {
  if (a.completedAt) return "concluida";
  if (cancelled) return "cancelada";
  if (a.doneRequestedAt) return "aguardando";
  if (dueDate && isOverdue(dueDate)) return "atrasada";
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
  open: "gray",
  in_progress: "blue",
  waiting: "amber",
  resolved: "green",
  closed: "dark",
  cancelled: "pink",
};

// Status "de exibição": vira Atrasado (vermelho) quando o prazo expirou e o
// chamado ainda está aberto. Não é um valor do enum — é derivado na hora.
export function ticketStatusView(
  status: Enums<"ticket_status">,
  overdue: boolean,
  awaitingApproval = false,
): { label: string; tone: Tone } {
  // aguardando o "de acordo" do solicitante para concluir definitivamente
  if (awaitingApproval && !["resolved", "closed", "cancelled"].includes(status)) {
    return { label: "Aguardando de acordo", tone: "amber" };
  }
  if (overdue && !["resolved", "closed", "cancelled"].includes(status)) {
    return { label: "Atrasado", tone: "red" };
  }
  return { label: TICKET_STATUS[status], tone: TICKET_STATUS_TONE[status] };
}

// legado: chamados antigos usavam um enum fixo de "categoria" (hoje virou Setor configurável)
export const TICKET_CATEGORY: Record<Enums<"ticket_category">, string> = {
  ti: "TI",
  servicos_gerais: "Serviços Gerais",
  facilities: "Facilities",
  rh: "RH",
  financeiro: "Financeiro",
  outros: "Outros",
};

export const TICKET_SLA_UNIT: Record<Enums<"ticket_sla_unit">, string> = {
  horas: "horas",
  dias_corridos: "dias corridos",
  dias_uteis: "dias úteis",
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

// ---------- Metas individuais (farol) ----------
/**
 * Tipo da meta. O nome do campo no banco é `direction`, que ficou estreito: hoje
 * ele diz o TIPO, não só o sentido.
 *
 * "Sim ou não" é um marcador de INTERFACE, não uma regra de cálculo. Por baixo
 * ela é `maior_melhor` com meta 100 e realizado 0 ou 100, então `farolAttainment`
 * e `attainmentCredit` já a tratam certo sem nenhuma linha nova. O que muda é a
 * tela: pede OK/NOK em vez de um número, e não pergunta meta nem parcial.
 */
export const GOAL_DIRECTION: Record<Enums<"goal_direction">, string> = {
  maior_melhor: "Maior é melhor",
  menor_melhor: "Menor é melhor",
  binaria: "Sim ou não (atingiu ou não)",
};

/**
 * Só os tipos numéricos, para as telas que não fazem sentido com sim/não.
 *
 * PNR e Sustentabilidade compartilham o mesmo campo `direction`, e tecnicamente
 * funcionariam com meta binária. Ficam de fora porque ninguém pediu, e opção que
 * não vai ser usada é ruído no formulário. Se um dia precisarem, é só apagar o
 * filtro nas duas telas.
 */
export const DIRECOES_NUMERICAS: Enums<"goal_direction">[] = ["maior_melhor", "menor_melhor"];

/** true quando a meta é do tipo sim/não: a tela troca número por OK/NOK. */
export function isMetaBinaria(direction: Enums<"goal_direction">): boolean {
  return direction === "binaria";
}

/** Valor gravado no `actual_value` de uma meta binária. */
export const BINARIA_OK = 100;
export const BINARIA_NOK = 0;

export const FAROL_LABEL: Record<"atingida" | "parcial" | "nao_atingida" | "pendente", string> = {
  atingida: "Atingida",
  parcial: "Parcial",
  nao_atingida: "Não atingida",
  pendente: "Pendente",
};

export const FAROL_TONE: Record<"atingida" | "parcial" | "nao_atingida" | "pendente", Tone> = {
  atingida: "green",
  parcial: "amber",
  nao_atingida: "red",
  pendente: "gray",
};

// status de fechamento mensal (aprovação da meta apurada)
export const GOAL_ENTRY_STATUS: Record<Enums<"goal_entry_status">, string> = {
  aberta: "Em apuração",
  aprovada: "Aprovada",
  reprovada: "Reprovada — revisar",
};

export const GOAL_ENTRY_STATUS_TONE: Record<Enums<"goal_entry_status">, Tone> = {
  aberta: "gray",
  aprovada: "green",
  reprovada: "red",
};

// ---------- Punições ----------
// A gravidade é do CATÁLOGO de infração, não do lançamento: o mesmo fato não
// pode ser leve para um gestor e grave para outro.
export const INFRACTION_SEVERITY: Record<Enums<"infraction_severity">, string> = {
  leve: "Leve",
  media: "Média",
  grave: "Grave",
};

export const INFRACTION_SEVERITY_TONE: Record<Enums<"infraction_severity">, Tone> = {
  leve: "gray",
  media: "amber",
  grave: "red",
};

// O rótulo diz em que MÃO está o lançamento, porque é isso que a pessoa quer
// saber ao abrir a lista. "Aprovada" é o único estado que vale como punição e
// entra no cálculo da remuneração variável.
export const PUNICAO_STATUS: Record<Enums<"punicao_status">, string> = {
  rascunho: "Rascunho",
  pendente: "Aguardando o RH",
  aprovada: "Aprovada",
  reprovada: "Reprovada",
  cancelada: "Cancelada",
};

export const PUNICAO_STATUS_TONE: Record<Enums<"punicao_status">, Tone> = {
  rascunho: "gray",
  pendente: "amber",
  aprovada: "green",
  reprovada: "red",
  cancelada: "gray",
};

// ---------- Férias e ausências ----------
export const ABSENCE_KIND_LABEL: Record<Enums<"absence_kind">, string> = {
  ferias: "Férias",
  licenca: "Licença",
  afastamento: "Afastamento",
  atestado: "Atestado",
  falta: "Falta sem justificativa",
};

export const ABSENCE_KIND_TONE: Record<Enums<"absence_kind">, Tone> = {
  ferias: "blue",
  licenca: "purple",
  afastamento: "amber",
  atestado: "gray",
  falta: "red",
};

/**
 * Se o tipo vem marcado como "desconta da remuneração variável" ao abrir o
 * formulário. É só o PADRÃO: a marcação é gravada por lançamento e pode ser
 * trocada, porque um atestado de um dia e um de trinta não merecem o mesmo
 * tratamento, e quem decide isso é a empresa.
 */
/**
 * Marcação inicial do "desconta RV proporcional" ao escolher o tipo.
 *
 * `atestado` e `falta` nascem DESMARCADOS porque quem cuida deles é o redutor
 * por faixa (`rv_reducer_rules`), e descontar os dias além da faixa puniria duas
 * vezes o mesmo dia. O cálculo não depende desta marcação: `fatorRv` ignora
 * qualquer tipo que tenha regra ativa. Isto aqui é só o palpite do formulário.
 */
export const ABSENCE_DESCONTA_PADRAO: Record<Enums<"absence_kind">, boolean> = {
  ferias: true,
  licenca: true,
  afastamento: true,
  atestado: false,
  falta: false,
};

/**
 * Situação do lançamento de absenteísmo.
 *
 * "Não comparecimento" é o aviso de que a pessoa não apareceu: existe, já
 * disparou o comunicado, e ainda não é absenteísmo nenhum. Só "Aprovado" vira
 * ausência de verdade e conta para a remuneração variável.
 */
export const ABSENTEISMO_STATUS: Record<Enums<"absenteismo_status">, string> = {
  aberto: "Não comparecimento",
  pendente: "Aguardando o RH",
  aprovado: "Aprovado",
  reprovado: "Reprovado",
  cancelado: "Cancelado",
};

export const ABSENTEISMO_STATUS_TONE: Record<Enums<"absenteismo_status">, Tone> = {
  aberto: "blue",
  pendente: "amber",
  aprovado: "green",
  reprovado: "red",
  cancelado: "gray",
};

// ---------- Feedbacks ----------
export const FEEDBACK_TYPE_LABEL: Record<Enums<"feedback_type">, string> = {
  reconhecimento: "Reconhecimento",
  construtivo: "Construtivo",
  neutro: "Neutro",
};
export const FEEDBACK_TYPE_TONE: Record<Enums<"feedback_type">, Tone> = {
  reconhecimento: "green",
  construtivo: "amber",
  neutro: "gray",
};
export const FEEDBACK_VISIBILITY_LABEL: Record<Enums<"feedback_visibility">, string> = {
  compartilhado: "Compartilhado",
  privado: "Nota privada",
};
export const FEEDBACK_CHANNEL_LABEL: Record<Enums<"feedback_channel">, string> = {
  presencial: "Presencial",
  reuniao_1a1: "Reunião 1:1",
  videochamada: "Videochamada",
  mensagem: "Mensagem",
  outro: "Outro",
};
// estado de aplicação (conversado com o colaborador)
export const FEEDBACK_APPLIED_LABEL = { registrado: "Registrado", aplicado: "Aplicado" } as const;

// PDI — status das ações de desenvolvimento
export const PDI_STATUS_LABEL: Record<Enums<"pdi_action_status">, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  conclusao_solicitada: "Conclusão solicitada",
  concluida: "Concluída",
  cancelada: "Cancelada",
};
export const PDI_STATUS_TONE: Record<Enums<"pdi_action_status">, Tone> = {
  pendente: "gray",
  em_andamento: "blue",
  conclusao_solicitada: "amber",
  concluida: "green",
  cancelada: "red",
};

// ---------- Checklists ----------
export const CHECKLIST_ITEM_TYPE_LABEL: Record<Enums<"checklist_item_type">, string> = {
  conformidade: "Conformidade",
  sim_nao: "Sim / Não",
  texto: "Texto",
  numero: "Número",
  selecao: "Seleção",
  nota: "Nota / escala",
};
export const CHECKLIST_FREQUENCY_LABEL: Record<Enums<"checklist_frequency">, string> = {
  unica: "Data fixa (única)",
  diaria: "Diária",
  semanal: "Semanal",
  mensal: "Mensal",
  anual: "Anual",
};
export const CHECKLIST_VISIBILITY_LABEL: Record<Enums<"checklist_visibility">, string> = {
  todos: "Todos os usuários",
  usuarios: "Usuários específicos",
  cargos: "Cargos específicos",
  areas: "Áreas específicas",
};
export const CHECKLIST_RUN_STATUS_LABEL: Record<Enums<"checklist_run_status">, string> = {
  em_andamento: "Em andamento",
  concluida: "Concluída",
};
export const CHECKLIST_CONFORMIDADE_LABEL: Record<"conforme" | "nao_conforme" | "na", string> = {
  conforme: "Conforme",
  nao_conforme: "Não conforme",
  na: "N.A.",
};
/**
 * Sim/Não é o mesmo conceito da conformidade, só com outro rótulo: "Não" conta como
 * não conformidade, gera tarefa e entra no percentual igual. Por isso a resposta é
 * gravada na mesma coluna (conforme/nao_conforme/na) e só a exibição muda.
 */
export const CHECKLIST_SIM_NAO_LABEL: Record<"conforme" | "nao_conforme" | "na", string> = {
  conforme: "Sim",
  nao_conforme: "Não",
  na: "N/A",
};
export const checklistAnswerLabel = (type: Enums<"checklist_item_type">) =>
  type === "sim_nao" ? CHECKLIST_SIM_NAO_LABEL : CHECKLIST_CONFORMIDADE_LABEL;
/** Tipos que pontuam e podem ser criados hoje; os demais voltam com o construtor de formulários. */
export const CHECKLIST_SCORED_TYPES = ["conformidade", "sim_nao"] as const;
export const CHECKLIST_CONFORMIDADE_TONE: Record<"conforme" | "nao_conforme" | "na", Tone> = {
  conforme: "green",
  nao_conforme: "red",
  na: "gray",
};
export const WEEKDAYS_PT = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const CHECKLIST_TASK_STATUS_LABEL: Record<Enums<"checklist_task_status">, string> = {
  pendente: "Pendente",
  em_andamento: "Em tratamento",
  concluida: "Concluída",
  cancelada: "Cancelada",
};
export const CHECKLIST_TASK_STATUS_TONE: Record<Enums<"checklist_task_status">, Tone> = {
  pendente: "red",
  em_andamento: "amber",
  concluida: "green",
  cancelada: "gray",
};

// ---------- Diário de bordo (agenda) ----------
export const AGENDA_STATUS_LABEL: Record<Enums<"agenda_log_status">, string> = {
  pendente: "Pendente",
  feito: "Realizada",
  parcial: "Parcial",
  nao_feito: "Não realizada",
};
export const AGENDA_STATUS_TONE: Record<Enums<"agenda_log_status">, Tone> = {
  pendente: "gray",
  feito: "green",
  parcial: "amber",
  nao_feito: "red",
};
export const AGENDA_FREQUENCY_LABEL: Record<Enums<"agenda_frequency">, string> = {
  diaria: "Diária",
  semanal: "Semanal",
  mensal: "Mensal",
  unica: "Data única",
};
/** Peso de cada status no cálculo de aderência. */
export const AGENDA_STATUS_WEIGHT: Record<Enums<"agenda_log_status">, number> = {
  pendente: 0,
  feito: 1,
  parcial: 0.5,
  nao_feito: 0,
};
/** Jornada diária padrão em minutos (8h). */
export const AGENDA_WORKDAY_MINUTES = 8 * 60;

// ---------- Gravação/transcrição de reuniões ----------
export const RECORDING_STATUS_LABEL: Record<Enums<"recording_transcript_status">, string> = {
  pendente: "Pendente",
  processando: "Processando",
  concluida: "Concluída",
  falha: "Falha",
};
export const RECORDING_STATUS_TONE: Record<Enums<"recording_transcript_status">, Tone> = {
  pendente: "gray",
  processando: "amber",
  concluida: "green",
  falha: "red",
};
/** Modelos de transcrição da OpenAI disponíveis (rótulos p/ Configurações). */
export const TRANSCRIBE_MODELS = ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "gpt-4o-transcribe-diarize"] as const;
export const TRANSCRIBE_MODEL_LABEL: Record<(typeof TRANSCRIBE_MODELS)[number], string> = {
  "gpt-4o-mini-transcribe": "gpt-4o-mini-transcribe (melhor custo-benefício)",
  "gpt-4o-transcribe": "gpt-4o-transcribe (mais preciso)",
  "gpt-4o-transcribe-diarize": "gpt-4o-transcribe-diarize (com locutores)",
};

// ---------- PNR (Programa Nacional de Revendas) ----------
export const PNR_TIER_LABEL: Record<"total" | "alta" | "baixa" | "zero" | "pendente", string> = {
  total: "Meta cheia",
  alta: "Parcial alta",
  baixa: "Parcial baixa",
  zero: "Não atingida",
  pendente: "Pendente",
};

export const PNR_TIER_TONE: Record<"total" | "alta" | "baixa" | "zero" | "pendente", Tone> = {
  total: "green",
  alta: "amber",
  baixa: "amber",
  zero: "red",
  pendente: "gray",
};

// ---------- Metas da área ----------
export const AREA_GOAL_KIND: Record<Enums<"area_goal_kind">, string> = {
  ic: "IC",
  iv: "IV",
};

export const AREA_GOAL_KIND_FULL: Record<Enums<"area_goal_kind">, string> = {
  ic: "Índice de Controle",
  iv: "Índice de Verificação",
};

export const CONSOLIDATION_LABEL: Record<Enums<"area_consolidation">, string> = {
  soma: "Soma",
  media: "Média",
  razao: "Razão (nº ÷ total)",
  manual: "Manual",
};

// ---------- Prioridade ----------
export const PRIORITY: Record<Enums<"priority_level">, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

export const PRIORITY_TONE: Record<Enums<"priority_level">, Tone> = {
  low: "green",
  medium: "amber",
  high: "red",
  urgent: "purple",
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
/**
 * Nomes usados onde o papel aparece isolado (menu do usuário, ficha de perfil).
 *
 * `manager` era rotulado "Gestor" aqui e "Gerencial" no USER_TYPE, então a mesma
 * pessoa lia um nome no próprio menu e outro na lista de colaboradores. Com um
 * perfil Gestor de verdade existindo, isso deixaria de ser inconsistência e
 * viraria informação errada: os dois mapas agora concordam.
 */
export const ROLE: Record<Enums<"member_role">, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  manager: "Gerencial",
  team_lead: "Gestor",
  hr: "RH",
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
/**
 * Rótulos dos perfis, em ordem de hierarquia. O seletor de perfil, os selos da
 * lista de colaboradores e a ficha leem daqui, então a ordem desta lista é a
 * ordem que aparece na tela.
 *
 * "Gerencial" e "Gestor" são coisas diferentes e a confusão entre as duas é fácil:
 * - `manager` (Gerencial): empresa inteira. Vê todos os chamados, faz triagem e
 *   abre os Logs do sistema.
 * - `team_lead` (Gestor): só a própria equipe, mas a cadeia inteira abaixo dele.
 *   Não é atalho para nada de empresa: sem chamados de terceiros, sem logs.
 *
 * `hr` (RH) é de outra natureza: não é um degrau da hierarquia, é um funcionário
 * comum com alçada num assunto. Ele edita departamento pessoal (cadastro, férias,
 * punições e remuneração variável) e mais nada; não redefine senha e não muda o
 * perfil de ninguém. Por isso aparece depois de Gestor e antes de Funcionário.
 */
export const USER_TYPE: Partial<Record<Enums<"member_role">, string>> = {
  admin: "Administrador",
  manager: "Gerencial",
  team_lead: "Gestor",
  hr: "RH",
  member: "Funcionário",
};

export type Tone =
  | "blue"
  | "green"
  | "amber"
  | "red"
  | "gray"
  | "purple"
  | "dark"
  | "pink";

// helper para transformar enum -> [{value,label}]
export function options<T extends string>(map: Record<T, string>) {
  return (Object.entries(map) as [T, string][]).map(([value, label]) => ({
    value,
    label,
  }));
}
