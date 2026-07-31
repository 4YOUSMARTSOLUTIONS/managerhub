import type { Enums } from "@/types/database";

export type ScheduleLite = {
  frequency: Enums<"checklist_frequency">;
  fixedDate: string | null; // YYYY-MM-DD
  weekday: number | null; // 0=Dom..6=Sáb
  dayOfMonth: number | null; // 1..31
  runTime: string | null; // HH:MM(:SS)
};

export type Occurrence = { periodKey: string; dueAt: Date; overdue: boolean };

function pad(n: number) { return String(n).padStart(2, "0"); }
function ymd(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/** Semana ISO no formato YYYY-Www. */
function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad(week)}`;
}

function atTime(d: Date, runTime: string | null): Date {
  const out = new Date(d);
  if (runTime) { const [h, m] = runTime.split(":"); out.setHours(Number(h) || 23, Number(m) || 59, 0, 0); }
  else out.setHours(23, 59, 0, 0);
  return out;
}

/** Ocorrência corrente do agendamento e se está atrasada. Retorna null se não houver
 *  ocorrência ativa (ex.: única sem data). Tudo em horário local do usuário. */
export function currentOccurrence(s: ScheduleLite, now: Date = new Date()): Occurrence | null {
  switch (s.frequency) {
    case "diaria": {
      const dueAt = atTime(now, s.runTime);
      return { periodKey: ymd(now), dueAt, overdue: now > dueAt };
    }
    case "semanal": {
      const wd = s.weekday ?? now.getDay();
      const occ = new Date(now);
      occ.setDate(now.getDate() + (wd - now.getDay()));
      const dueAt = atTime(occ, s.runTime);
      return { periodKey: isoWeek(now), dueAt, overdue: now > dueAt };
    }
    case "mensal": {
      const y = now.getFullYear(), m = now.getMonth();
      const last = new Date(y, m + 1, 0).getDate();
      const day = Math.min(s.dayOfMonth ?? 1, last);
      const dueAt = atTime(new Date(y, m, day), s.runTime);
      return { periodKey: `${y}-${pad(m + 1)}`, dueAt, overdue: now > dueAt };
    }
    case "anual": {
      const y = now.getFullYear();
      let occ: Date;
      if (s.fixedDate) { const [, mm, dd] = s.fixedDate.split("-").map(Number); occ = new Date(y, (mm || 1) - 1, dd || 1); }
      else occ = new Date(y, 11, 31);
      const dueAt = atTime(occ, s.runTime);
      return { periodKey: `${y}`, dueAt, overdue: now > dueAt };
    }
    case "unica": {
      if (!s.fixedDate) return null;
      const [yy, mm, dd] = s.fixedDate.split("-").map(Number);
      const dueAt = atTime(new Date(yy, (mm || 1) - 1, dd || 1), s.runTime);
      return { periodKey: s.fixedDate, dueAt, overdue: now > dueAt };
    }
  }
}
