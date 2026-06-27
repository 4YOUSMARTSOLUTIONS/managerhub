const TZ = "America/Sao_Paulo";

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: TZ,
  }).format(new Date(value));
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  // datas puras (YYYY-MM-DD) não devem sofrer shift de fuso
  const d = value.length === 10 ? new Date(value + "T12:00:00") : new Date(value);
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(d);
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeStyle: "short",
    timeZone: TZ,
  }).format(new Date(value));
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(
    value,
  );
}

export function relativeDays(date: string | null): number | null {
  if (!date) return null;
  const target = new Date(date.length === 10 ? date + "T12:00:00" : date);
  const today = new Date();
  const diff = Math.ceil(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  return diff;
}

export function isOverdue(date: string | null): boolean {
  const d = relativeDays(date);
  return d !== null && d < 0;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}
