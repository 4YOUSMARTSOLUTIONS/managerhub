import type { Enums } from "@/types/database";
import { blockedReason } from "@/lib/holidays";
import { currentOccurrence, type Occurrence } from "@/lib/checklist-schedule";
import { AGENDA_STATUS_WEIGHT } from "@/lib/constants";

// ---------- Tarefas da agenda ----------
export type TaskLite = {
  frequency: Enums<"agenda_frequency">;
  weekdays: number[]; // 0=Dom..6=Sáb (para semanal)
  dayOfMonth: number | null; // 1..31 (para mensal)
  fixedDate: string | null; // YYYY-MM-DD (para única)
};

function pad(n: number) { return String(n).padStart(2, "0"); }
export function ymd(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/** Converte "YYYY-MM-DD" para Date no fuso local (meio-dia, evita drift). */
export function dateFromYMD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

/** A tarefa ocorre nesta data, conforme sua recorrência? */
export function taskOccursOn(t: TaskLite, date: Date): boolean {
  switch (t.frequency) {
    case "diaria":
      return true;
    case "semanal":
      return (t.weekdays ?? []).includes(date.getDay());
    case "mensal": {
      const y = date.getFullYear(), m = date.getMonth();
      const last = new Date(y, m + 1, 0).getDate();
      const day = Math.min(t.dayOfMonth ?? 1, last);
      return date.getDate() === day;
    }
    case "unica":
      return !!t.fixedDate && t.fixedDate === ymd(date);
  }
}

/** Dia não trabalhado (domingo ou feriado): retorna o motivo, ou null se é dia útil. */
export function nonWorkingReason(date: Date, holidays?: { day: string; name: string }[]): string | null {
  return blockedReason(date, holidays);
}

// ---------- Integração com Checklists ----------
export type ChecklistSchedLite = {
  frequency: Enums<"checklist_frequency">;
  fixedDate: string | null;
  weekday: number | null;
  dayOfMonth: number | null;
  runTime: string | null;
};
export type ChecklistTarget = { kind: string; refId: string };
export type UserOrg = { userId: string; positionId: string | null; departmentId: string | null };

/** O agendamento de checklist mira este usuário (direto, por cargo ou por setor)? */
export function checklistTargetsUser(targets: ChecklistTarget[], org: UserOrg): boolean {
  return targets.some(
    (t) =>
      (t.kind === "user" && t.refId === org.userId) ||
      (t.kind === "position" && !!org.positionId && t.refId === org.positionId) ||
      (t.kind === "department" && !!org.departmentId && t.refId === org.departmentId),
  );
}

/** Ocorrência do checklist SE ele cai exatamente nesta data (senão null). Reaproveita a matemática de checklist-schedule. */
export function checklistOccurrenceForDate(s: ChecklistSchedLite, date: Date): Occurrence | null {
  const occ = currentOccurrence(
    { frequency: s.frequency, fixedDate: s.fixedDate, weekday: s.weekday, dayOfMonth: s.dayOfMonth, runTime: s.runTime },
    date,
  );
  if (!occ) return null;
  // só entra na agenda no dia agendado daquele período
  if (ymd(occ.dueAt) !== ymd(date)) return null;
  return occ;
}

// ---------- Indicadores ----------
/** Aderência (0..1) a partir de uma lista de status cobráveis. null se não há itens. */
export function adherenceFromStatuses(statuses: Enums<"agenda_log_status">[]): number | null {
  if (!statuses.length) return null;
  const score = statuses.reduce((s, st) => s + AGENDA_STATUS_WEIGHT[st], 0);
  return score / statuses.length;
}

export function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

/** Formata minutos como "8h", "6h30", "45min". */
export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${pad(m)}`;
}
