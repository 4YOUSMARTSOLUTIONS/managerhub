/**
 * Horas da ausência parcial (LUIZ, 21/11/2026).
 *
 * O turno da noite atravessa a meia-noite: ausente "das 20:16 às 02:47" é uma
 * ausência de 6h31 que termina no dia seguinte. Regra: o "Até" menor que o
 * "Ausente das" é do dia seguinte; horários iguais não são ausência parcial.
 * O banco segue a mesma regra (constraint `absenteismo_horas_coerentes` e a
 * coluna de horas do `absenteismo_relatorio`).
 *
 * Módulo sem "use server": é usado pela tela e pelas actions.
 */

/** "HH:MM" ou "HH:MM:SS" em minutos do dia; null se não for horário */
function minutosDoDia(hora: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hora?.trim() ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Duração da ausência em minutos (0 quando os horários são iguais); null se faltar horário. */
export function minutosDeAusencia(inicio: string | null | undefined, fim: string | null | undefined): number | null {
  const a = minutosDoDia(inicio);
  const b = minutosDoDia(fim);
  if (a === null || b === null) return null;
  return (b - a + 1440) % 1440;
}

/** O "Até" cai no dia seguinte (fim antes do início). */
export function terminaNoDiaSeguinte(inicio: string | null | undefined, fim: string | null | undefined): boolean {
  const a = minutosDoDia(inicio);
  const b = minutosDoDia(fim);
  return a !== null && b !== null && b < a;
}

/** "6h31", "2h" */
export function rotuloDeHoras(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** "20:16 às 02:47 do dia seguinte", "08:00 às 10:00"; vazio sem início */
export function faixaDaAusencia(inicio: string | null | undefined, fim: string | null | undefined): string {
  if (!inicio) return "";
  const base = `${inicio.slice(0, 5)} às ${fim?.slice(0, 5) ?? "?"}`;
  return terminaNoDiaSeguinte(inicio, fim) ? `${base} do dia seguinte` : base;
}

/** Frase de erro para as actions; null quando os horários servem. */
export function erroDosHorarios(inicio: string, fim: string): string | null {
  if (!inicio && !fim) return null;
  if (!inicio || !fim) return "Informe os dois horários: ausente das e até.";
  const min = minutosDeAusencia(inicio, fim);
  if (min === null) return "Horário inválido.";
  if (min === 0) return "Os horários de início e fim da ausência não podem ser iguais.";
  return null;
}
