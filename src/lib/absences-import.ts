/**
 * Leitura das colunas da planilha de férias e afastamentos.
 *
 * Mora fora do diálogo E fora da action porque as duas pontas precisam
 * concordar: o diálogo mostra "3 linhas inválidas" antes de gravar, e o servidor
 * decide o que de fato entra. Se cada lado tivesse a sua interpretação de
 * "16/07/2026" ou de "Sim", a prévia mentiria.
 *
 * Um arquivo `"use server"` só pode exportar função assíncrona, então este
 * também é o único lugar de onde dá para testar essas regras sem navegador.
 */

import type { Enums } from "@/types/database";
import { ABSENCE_DESCONTA_PADRAO } from "@/lib/constants";

export type AbsenceKind = Enums<"absence_kind">;

export const normTexto = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Data da planilha para `YYYY-MM-DD`, ou "" se não der para entender.
 *
 * Aceita a célula já tipada como data pelo Excel, `DD/MM/AAAA` (o que a pessoa
 * digita) e `AAAA-MM-DD` (o que sai de uma exportação). Dia e mês NUNCA são
 * trocados: aqui é sempre dia primeiro, como no resto do sistema.
 */
export function parseDataPlanilha(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valida(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return valida(+m[3], +m[2], +m[1]);
  return "";
}

/** 31/02 não vira 03/03: data que não existe é recusada, não corrigida */
function valida(ano: number, mes: number, dia: number): string {
  if (mes < 1 || mes > 12 || dia < 1) return "";
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (dia > ultimo) return "";
  return `${ano}-${pad(mes)}-${pad(dia)}`;
}

/**
 * Tipo escrito à mão para o valor do enum. `null` = escreveram algo que não dá
 * para classificar, e a linha é recusada em vez de virar Férias por engano.
 *
 * O casamento é por trecho, não exato, senão "Licença maternidade" e
 * "Afastamento INSS" cairiam fora sem motivo.
 */
export function parseTipo(v: string): AbsenceKind | null {
  const s = normTexto(v ?? "");
  if (!s) return "ferias"; // coluna em branco: o caso mais comum
  if (s.includes("feria")) return "ferias";
  if (s.includes("licen")) return "licenca";
  if (s.includes("afasta")) return "afastamento";
  if (s.includes("atestad")) return "atestado";
  return null;
}

/**
 * Reexportado de `constants.ts`, e não redefinido aqui: o padrão que o
 * formulário manual usa tem de ser o mesmo que a planilha usa. Duas cópias
 * fariam um atestado importado descontar e um digitado não.
 */
export const DESCONTA_PADRAO = ABSENCE_DESCONTA_PADRAO;

const SIM = ["sim", "s", "true", "1", "x", "verdadeiro"];
const NAO = ["nao", "n", "false", "0", "falso"];

/** Coluna vazia ou incompreensível cai no padrão do tipo. */
export function parseDesconta(v: string, kind: AbsenceKind): boolean {
  const s = normTexto(v ?? "");
  if (SIM.includes(s)) return true;
  if (NAO.includes(s)) return false;
  return DESCONTA_PADRAO[kind];
}

/** Dois períodos fechados nas duas pontas se cruzam? */
export const periodosCruzam = (aIni: string, aFim: string, bIni: string, bFim: string) =>
  aIni <= bFim && bIni <= aFim;
