import type { Enums } from "@/types/database";

export type AgendaTaskFull = {
  id: string;
  title: string;
  description: string | null;
  scheduledTime: string | null; // HH:MM
  durationMinutes: number;
  frequency: Enums<"agenda_frequency">;
  weekdays: number[];
  dayOfMonth: number | null;
  fixedDate: string | null;
  active: boolean;
  flexible: boolean; // sem horário fixo, duração média (conta na carga do dia)
};

export type AgendaFull = {
  id: string;
  name: string;
  description: string | null;
  unitId: string | null;
  unitName: string | null;
  ownerId: string;
  ownerName: string;
  responsibleId: string;
  responsibleName: string;
  canResponsibleEdit: boolean;
  active: boolean;
  createdDate: string; // YYYY-MM-DD (não cobra dias anteriores à criação)
  tasks: AgendaTaskFull[];
};

export type LogRow = {
  id: string;
  agendaId: string;
  taskId: string;
  logDate: string; // YYYY-MM-DD
  status: Enums<"agenda_log_status">;
  note: string | null;
  actualMinutes: number | null;
};

export type ChecklistSchedFull = {
  checklistId: string;
  checklistName: string;
  scheduleId: string;
  frequency: Enums<"checklist_frequency">;
  fixedDate: string | null;
  weekday: number | null;
  dayOfMonth: number | null;
  runTime: string | null;
  targets: { kind: string; refId: string }[];
};

export type ChecklistRunLite = { checklistId: string; executorId: string; periodKey: string };

/** Item renderizado no dia: tarefa de agenda ou checklist periódico. */
export type DayItem = {
  kind: "task" | "checklist";
  key: string;
  date: string; // YYYY-MM-DD a que o item pertence
  title: string;
  agendaName: string;
  time: string | null; // HH:MM
  durationMin: number;
  status: Enums<"agenda_log_status">;
  note: string | null;
  chargeable: boolean;
  flexible?: boolean; // tarefa de duração média, sem horário fixo
  // task
  taskId?: string;
  agendaId?: string;
  logId?: string | null;
  /** já tem observação, comentário ou anexo: o ícone de detalhe acende. */
  hasDetail?: boolean;
  // checklist
  checklistId?: string;
  overdue?: boolean;
};

export type OrgInfo = { positionId: string | null; departmentId: string | null };
