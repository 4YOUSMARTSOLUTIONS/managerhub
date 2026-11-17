/**
 * Leitura da planilha de COMUNICADOS de absenteísmo (LUIZ, 17/11/2026).
 *
 * A irmã do histórico (`absenteismo-historico.ts`): cada linha é um dia em que
 * a pessoa não compareceu e o motivo ainda não foi confirmado. Entra EM ABERTO,
 * no nome do gestor atual, sem e-mail, e segue pelo Efetivar. Quem confere o
 * que depende do banco e grava é a RPC `absenteismo_importar_comunicados`.
 *
 * Fora do arquivo de actions porque as regras puras servem às duas pontas, e
 * um arquivo `"use server"` só exporta função assíncrona.
 */

import { normTexto } from "@/lib/absences-import";

/** O cabeçalho do modelo, na ordem. A leitura aceita as colunas em qualquer ordem. */
export const COLUNAS_COMUNICADOS = ["CPF", "ID", "Unidade", "Colaborador", "Data", "Observação"] as const;

/**
 * Uma linha como saiu da planilha. A data já chega normalizada pelo navegador:
 * `""` = vazia, `null` = escreveram algo que não dá para entender.
 */
export type LinhaComunicado = {
  /** número da linha na planilha (o cabeçalho é a 1) */
  linha: number;
  /** só dígitos, com os zeros da frente que o Excel apaga quando a célula é número */
  cpf: string;
  code: string;
  unit: string;
  /** só conferência: o sistema NÃO casa por nome */
  name: string;
  data: string | null;
  obs: string;
};

/**
 * CPF da célula, só dígitos. Célula numérica perde os zeros da frente
 * (092.936... vira 92936...), então o que tem menos de 11 dígitos é completado.
 */
export function cpfDaCelula(v: unknown): string {
  if (v == null) return "";
  const digitos = typeof v === "number"
    ? (Number.isFinite(v) ? String(Math.trunc(v)) : "")
    : String(v).replace(/\D/g, "");
  if (!digitos) return "";
  return digitos.length < 11 ? digitos.padStart(11, "0") : digitos;
}

/** Onde está cada coluna. `-1` = a planilha não tem. */
export function mapearColunasComunicados(cabecalho: unknown[]) {
  const h = cabecalho.map((c) => normTexto(String(c ?? "")));
  const usadas = new Set<number>();
  const achar = (teste: (x: string) => boolean) => {
    const i = h.findIndex((x, idx) => !usadas.has(idx) && teste(x));
    if (i >= 0) usadas.add(i);
    return i;
  };
  const cpf = achar((x) => x.includes("cpf"));
  // "ID" por igualdade: "unidade" contém "id"
  const code = achar((x) => x === "id" || x.includes("matricula") || x.startsWith("id ") || x.includes("identificador"));
  // a planilha do DP chama a unidade de "Matriz/Filial"
  const unit = achar((x) => x.includes("unidade") || x.includes("filial") || x.includes("matriz") || x === "loja");
  const name = achar((x) => x.includes("colaborador") || x === "nome" || x.includes("funcionario"));
  const data = achar((x) => x === "data" || x.startsWith("data ") || x === "dia" || x.includes("data da ausencia"));
  const obs = achar((x) => x.includes("observ") || x === "obs" || x.includes("o que se sabe"));
  return { cpf, code, unit, name, data, obs };
}
