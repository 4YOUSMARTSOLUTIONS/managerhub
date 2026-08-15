const TZ = "America/Sao_Paulo";

/**
 * Hoje em `YYYY-MM-DD`, no fuso LOCAL.
 *
 * `new Date().toISOString()` devolve UTC, e no Brasil isso vira a data de
 * amanhã a partir das 21h. Num formulário de "data do ocorrido" o efeito é
 * péssimo: o campo abre no dia seguinte, e o relato nasce com data que ainda
 * não aconteceu.
 */
export function hojeYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Soma dias a uma data `YYYY-MM-DD` sem passar por fuso. */
export function somarDias(ymd: string, dias: number): string {
  const [a, m, d] = ymd.split("-").map(Number);
  const base = new Date(Date.UTC(a, m - 1, d));
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

/** Encurta um nome completo para "Primeiro Último" (ignora nomes do meio). */
export function shortName(value: string | null | undefined): string {
  if (!value) return "—";
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "—";
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

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

/** Duração legível a partir de segundos: "1h 23min", "45min", "30s". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  if (m > 0) return `${m}min`;
  return `${s}s`;
}

/**
 * Texto pronto para comparar numa busca: minúsculas e sem acento.
 *
 * `NFD` separa a letra do acento e o intervalo removido é o dos sinais
 * combinantes (U+0300 a U+036F). Assim "João" acha "joao" e "MANUTENÇÃO" acha
 * "manutencao", que é o mínimo para uma busca em português não parecer quebrada.
 */
export function normalizar(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

/**
 * Valor de uma meta como ele deve APARECER.
 *
 * Numa meta de sim/não o número gravado é 100 ou 0, mas mostrar "100" não diz
 * nada a quem lê: o que importa é se foi feito. Aqui vira OK/NOK. Vale para
 * meta e realizado, e o `null` continua sendo o travessão de vazio.
 */
export function formatMetaValor(valor: number | null | undefined, binaria: boolean, unidade: string | null | undefined): string {
  if (valor == null) return "\u2014";
  if (binaria) return valor > 0 ? "OK" : "NOK";
  return formatValorComUnidade(valor, unidade);
}

// trunca em 2 casas (nunca arredonda; o epsilon corrige o erro de float da multiplica\u00e7\u00e3o)
function trunc2(v: number): number {
  const s = v < 0 ? -1 : 1;
  return (s * Math.floor(Math.abs(v) * 100 + 1e-9)) / 100;
}
const nfMeta = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * N\u00famero de meta com a unidade de medida colada, como ele deve APARECER.
 *
 * Sempre 2 casas, truncadas: "R$ 1.234,5" est\u00e1 errado para dinheiro, e
 * arredondar para cima faria um realizado abaixo da meta parecer dentro dela.
 *
 * A unidade \u00e9 texto livre digitado no cadastro, ent\u00e3o o tratamento \u00e9 por
 * conven\u00e7\u00e3o: dinheiro vem antes do n\u00famero, porcentagem vem colada, e o resto
 * vira sufixo separado por espa\u00e7o.
 *
 * Mora aqui, e n\u00e3o dentro de uma tela, porque nasceu privado do farol da \u00e1rea e
 * foi exatamente isso que deixou as metas individuais sem unidade nenhuma.
 */
export function formatValorComUnidade(valor: number | null | undefined, unidade: string | null | undefined): string {
  if (valor == null) return "\u2014";
  const t = trunc2(valor);
  const u = (unidade ?? "").trim();
  // "OK/NOK" n\u00e3o \u00e9 unidade digitada: \u00e9 o marcador que o formul\u00e1rio grava sozinho
  // na meta de sim/n\u00e3o. Numa meta num\u00e9rica ele sobra de um cadastro que mudou de
  // tipo, e "97,00 OK/NOK" n\u00e3o quer dizer nada.
  if (u.toUpperCase() === "OK/NOK") return nfMeta.format(t);
  if (u.toLowerCase().includes("r$")) return "R$ " + nfMeta.format(t);
  if (u === "%") return nfMeta.format(t) + "%";
  return nfMeta.format(t) + (u ? ` ${u}` : "");
}
