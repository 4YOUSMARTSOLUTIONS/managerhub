// Feriados nacionais brasileiros — cálculo determinístico (fixos + móveis pela
// Páscoa). Espelha as funções SQL national_holiday_name/easter_sunday usadas no
// banco. Sem dependências; usado no cliente para sinalizar/avisar no calendário.

const FIXED: Record<string, string> = {
  "01-01": "Confraternização Universal",
  "04-21": "Tiradentes",
  "05-01": "Dia do Trabalho",
  "09-07": "Independência do Brasil",
  "10-12": "Nossa Senhora Aparecida",
  "11-02": "Finados",
  "11-15": "Proclamação da República",
  "12-25": "Natal",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Domingo de Páscoa (algoritmo de Meeus/Butcher, Gregoriano). */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=março, 4=abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const addDays = (base: Date, days: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
};

/** Chave YYYY-MM-DD em horário local (sem deslocamento de fuso). */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const cache = new Map<number, Map<string, string>>();

/** Mapa YYYY-MM-DD → nome dos feriados nacionais de um ano (com cache). */
export function nationalHolidays(year: number): Map<string, string> {
  const hit = cache.get(year);
  if (hit) return hit;

  const map = new Map<string, string>();
  for (const [mmdd, name] of Object.entries(FIXED)) map.set(`${year}-${mmdd}`, name);
  if (year >= 2024) map.set(`${year}-11-20`, "Consciência Negra");

  const e = easterSunday(year);
  map.set(dateKey(addDays(e, -2)), "Sexta-feira Santa");
  map.set(dateKey(addDays(e, -48)), "Carnaval");
  map.set(dateKey(addDays(e, -47)), "Carnaval");
  map.set(dateKey(addDays(e, 60)), "Corpus Christi");

  cache.set(year, map);
  return map;
}

/** Nome do feriado (nacional ou customizado) para a data, ou null. */
export function holidayName(date: Date, custom?: { day: string; name: string }[]): string | null {
  const key = dateKey(date);
  const custHit = custom?.find((c) => c.day === key);
  if (custHit) return custHit.name;
  return nationalHolidays(date.getFullYear()).get(key) ?? null;
}
