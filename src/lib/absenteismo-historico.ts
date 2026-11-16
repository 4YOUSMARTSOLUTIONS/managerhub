/**
 * Leitura da planilha de HISTÓRICO de absenteísmo (LUIZ, 16/11/2026).
 *
 * Mora fora do diálogo e fora da action porque as duas pontas precisam ler a
 * mesma coisa: o navegador transforma a célula em texto/data, o servidor decide.
 * Um arquivo `"use server"` só exporta função assíncrona, então as regras puras
 * ficam aqui.
 *
 * A importação é só para o passado: o que acontece de hoje em diante segue o
 * fluxo normal (Lançar ausência → Efetivar → RH). Cada linha entra aprovada,
 * sem comunicado e sem anexo; quem confere tudo o que depende do banco é a RPC
 * `absenteismo_importar`.
 */

import { normTexto, parseDataPlanilha } from "@/lib/absences-import";

/** O cabeçalho do modelo, na ordem. A leitura aceita as colunas em qualquer ordem. */
export const COLUNAS_HISTORICO = [
  "ID", "Unidade", "Colaborador", "Motivo", "Início", "Fim", "Das", "Até", "Observação",
  "Tipo de atestado", "CID", "Profissional", "CRM", "Local de atendimento", "Data de emissão",
  "Acompanhado", "Parentesco", "Acidente de trabalho", "Abonada",
] as const;

/**
 * Uma linha como saiu da planilha. Datas e horas já chegam normalizadas pelo
 * navegador (a célula pode ser data do Excel, número de série ou texto):
 * `""` = célula vazia, `null` = escreveram algo que não dá para entender.
 */
export type LinhaHistorico = {
  /** número da linha na planilha (o cabeçalho é a 1) */
  linha: number;
  code: string;
  unit: string;
  /** só conferência: o sistema NÃO casa por nome */
  name: string;
  motivo: string;
  inicio: string | null;
  fim: string | null;
  das: string | null;
  ate: string | null;
  obs: string;
  tipoAtestado: string;
  cid: string;
  medico: string;
  crm: string;
  local: string;
  emissao: string | null;
  acompanhado: string;
  parentesco: string;
  acidente: string;
  abonada: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Número de série do Excel (sistema 1900) para `YYYY-MM-DD`. Lido em UTC de
 * propósito: com `cellDates` a biblioteca monta a data no fuso do navegador, e
 * datas antigas no fuso de Brasília saem com minutos de diferença.
 */
function serialParaIso(n: number): string {
  if (!Number.isFinite(n) || n < 61 || n > 2958465) return "";
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Data da célula: `YYYY-MM-DD`, `""` (vazia) ou `null` (ilegível). */
export function dataDaCelula(v: unknown): string | null {
  if (v == null || (typeof v === "string" && !v.trim())) return "";
  if (typeof v === "number") return serialParaIso(v) || null;
  return parseDataPlanilha(v) || null;
}

/**
 * Hora da célula: `HH:MM`, `""` (vazia) ou `null` (ilegível).
 *
 * Aceita a hora do Excel (fração do dia, 0,333 = 08:00) e o que a pessoa
 * digita: "08:00", "8:00", "8h", "08h30", "8:00:00".
 */
export function horaDaCelula(v: unknown): string | null {
  if (v == null || (typeof v === "string" && !v.trim())) return "";
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return null;
    // "8" digitado numa célula numérica é 08:00, não meia-noite do dia 8
    if (Number.isInteger(v) && v <= 23) return `${pad(v)}:00`;
    const minutos = Math.round((v % 1) * 1440);
    if (minutos >= 1440) return null;
    return `${pad(Math.floor(minutos / 60))}:${pad(minutos % 60)}`;
  }
  const s = String(v).trim().toLowerCase().replace(/\s+/g, "");
  const m = s.match(/^(\d{1,2})(?:[:h](\d{2})?(?::\d{2})?)?h?$/);
  if (!m) return null;
  const h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

const SIM = ["sim", "s", "x", "true", "1", "verdadeiro"];
const NAO = ["nao", "n", "false", "0", "falso"];

/** Sim/Não: vazio vale Não; `null` = escreveram outra coisa. */
export function simNao(v: string): boolean | null {
  const s = normTexto(v ?? "");
  if (!s || NAO.includes(s)) return false;
  if (SIM.includes(s)) return true;
  return null;
}

/** "Médico" / "Odontológico": `""` vazio, `null` ilegível. */
export function tipoDeAtestado(v: string): "" | "medico" | "odontologico" | null {
  const s = normTexto(v ?? "");
  if (!s) return "";
  if (s.includes("odonto") || s.includes("dentist")) return "odontologico";
  if (s.includes("medic")) return "medico";
  return null;
}

/**
 * CID como a tabela guarda: maiúsculo, com ponto antes do 4º caractere.
 * "m545", "M54,5" e " M54.5 " viram "M54.5"; "M54" fica "M54" (a categoria).
 */
export function normCid(v: string): string {
  const s = (v ?? "").toUpperCase().replace(/\s+/g, "").replace(",", ".").replace(/\.$/, "");
  const m = s.match(/^([A-Z]\d{2})(\d)$/);
  return m ? `${m[1]}.${m[2]}` : s;
}

/**
 * Onde está cada coluna. `-1` = a planilha não tem. A ordem das conferências
 * importa: "Tipo de atestado" precisa ser reconhecida antes de "Motivo"/"Tipo",
 * e "Data de emissão" antes de qualquer coisa que procure "data".
 */
export function mapearColunas(cabecalho: unknown[]) {
  const h = cabecalho.map((c) => normTexto(String(c ?? "")));
  const usadas = new Set<number>();
  const achar = (teste: (x: string) => boolean) => {
    const i = h.findIndex((x, idx) => !usadas.has(idx) && teste(x));
    if (i >= 0) usadas.add(i);
    return i;
  };
  const tipoAtestado = achar((x) => x.includes("tipo de atestado") || x.includes("tipo atestado"));
  const emissao = achar((x) => x.includes("emissao") || x.includes("emitido"));
  // "ID" por igualdade: "unidade" e "acidente" contêm "id"
  const code = achar((x) => x === "id" || x.includes("matricula") || x.startsWith("id ") || x.includes("identificador"));
  const unit = achar((x) => x.includes("unidade") || x === "filial" || x === "loja");
  const name = achar((x) => x.includes("colaborador") || x === "nome" || x.includes("funcionario"));
  const motivo = achar((x) => x === "motivo" || x.startsWith("motivo") || x === "tipo" || x.includes("tipo de ausencia"));
  const inicio = achar((x) => x.includes("inicio") || x === "de");
  const fim = achar((x) => x === "fim" || x.startsWith("fim ") || x.includes("termino"));
  const das = achar((x) => x === "das" || x.startsWith("das ") || x.includes("hora inicial") || x.includes("hora de inicio"));
  const ate = achar((x) => x === "ate" || x.startsWith("ate ") || x.includes("hora final") || x.includes("hora de fim"));
  const obs = achar((x) => x.includes("observ") || x === "obs");
  const cid = achar((x) => x === "cid" || x.startsWith("cid"));
  const medico = achar((x) => x.includes("profissional") || x.includes("medico"));
  const crm = achar((x) => x.includes("crm") || x.includes("registro"));
  const local = achar((x) => x.includes("local") || x.includes("hospital") || x.includes("clinica"));
  const acompanhado = achar((x) => x.includes("acompanhad"));
  const parentesco = achar((x) => x.includes("parentesco"));
  const acidente = achar((x) => x.includes("acidente"));
  const abonada = achar((x) => x.includes("abonad") || x.includes("abono"));
  return {
    code, unit, name, motivo, inicio, fim, das, ate, obs, tipoAtestado, cid, medico, crm, local,
    emissao, acompanhado, parentesco, acidente, abonada,
  };
}

/** `YYYY-MM-DD` → `DD/MM/AAAA` (para o resumo e a lista de recusadas) */
export const dataBR = (iso: string | null | undefined) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
