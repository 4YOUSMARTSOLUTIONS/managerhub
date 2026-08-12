import type { Enums } from "@/types/database";

/**
 * Estado efetivo de uma matrícula de treinamento.
 *
 * O banco guarda só o que é FATO (não iniciado, em andamento, concluído...).
 * O que depende do calendário é calculado aqui, na leitura, porque um status de
 * data gravado em coluna começa a mentir à meia-noite seguinte e só volta a
 * dizer a verdade quando algum job roda.
 *
 * A distinção que mais importa, e que quase todo LMS erra:
 *
 *   `atrasado`  a pessoa NÃO fez e o prazo passou
 *   `vencido`   a pessoa FEZ, e a validade do certificado caducou
 *
 * São problemas operacionais diferentes: o primeiro cobra a pessoa, o segundo
 * agenda a reciclagem. Misturar os dois num "pendente" só faz o RH descobrir na
 * auditoria.
 */
export type EffTrainingStatus =
  | "nao_iniciado"
  | "em_andamento"
  | "aguardando_correcao"
  | "atrasado"
  | "concluido"
  | "a_vencer"
  | "vencido"
  | "reprovado"
  | "isento"
  | "cancelado"
  | "nao_aplicavel"
  | "no_show";

export type EnrollmentForStatus = {
  status: Enums<"training_enrollment_status">;
  dueAt: string | null;
  expiresAt: string | null;
  /** dias antes do vencimento em que a reciclagem já pode ser feita */
  antecipacaoDias?: number | null;
};

/** hoje em `YYYY-MM-DD`, no fuso local. Datas aqui são texto o tempo todo, como em rv-proporcional. */
export function hojeYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** soma dias a uma data `YYYY-MM-DD` sem passar por fuso */
export function somarDias(ymd: string, dias: number): string {
  const [a, m, d] = ymd.split("-").map(Number);
  const base = new Date(Date.UTC(a, m - 1, d));
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

/** diferença em dias entre duas datas `YYYY-MM-DD` (b - a) */
export function diffDias(a: string, b: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(b) - p(a)) / 86_400_000);
}

/**
 * Vencimento do próximo ciclo, com data-base FIXA.
 *
 * Refazer antes da hora não empurra o calendário: quem tem validade em 10/12 e
 * recicla em 01/11 continua vencendo em 10/12 do ano seguinte. É o que a
 * auditoria de NR espera, e é o que impede o prazo de "andar" a cada ciclo
 * punindo justamente quem se antecipa.
 *
 * Sem vencimento anterior (primeira vez), a base é a conclusão.
 */
export function proximoVencimento(
  conclusaoYmd: string,
  validadeMeses: number | null,
  vencimentoAnteriorYmd: string | null,
): string | null {
  if (!validadeMeses || validadeMeses <= 0) return null;
  const base = vencimentoAnteriorYmd && vencimentoAnteriorYmd >= conclusaoYmd
    ? vencimentoAnteriorYmd
    : conclusaoYmd;
  const [a, m, d] = base.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + validadeMeses, 1));
  // dia clampeado ao último do mês, como no agendamento de checklists
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimoDia));
  return alvo.toISOString().slice(0, 10);
}

/** true quando a reciclagem já pode ser feita sem perder a data-base */
export function podeReciclar(e: EnrollmentForStatus, hoje = hojeYmd()): boolean {
  if (!e.expiresAt) return false;
  const janela = somarDias(e.expiresAt, -(e.antecipacaoDias ?? 60));
  return hoje >= janela;
}

export function effTrainingStatus(e: EnrollmentForStatus, hoje = hojeYmd()): EffTrainingStatus {
  // estados terminais e administrativos não dependem de calendário
  if (e.status === "cancelado" || e.status === "nao_aplicavel" || e.status === "reprovado"
      || e.status === "no_show" || e.status === "aguardando_correcao") {
    return e.status;
  }
  if (e.status === "isento") return "isento";

  if (e.status === "concluido") {
    if (!e.expiresAt) return "concluido"; // vitalício
    if (e.expiresAt < hoje) return "vencido";
    if (podeReciclar(e, hoje)) return "a_vencer";
    return "concluido";
  }

  // ainda não concluiu: o que pesa é o prazo, não a validade
  if (e.dueAt && e.dueAt < hoje) return "atrasado";
  return e.status; // nao_iniciado | em_andamento
}

export const TRAINING_STATUS_LABEL: Record<EffTrainingStatus, string> = {
  nao_iniciado: "Não iniciado",
  em_andamento: "Em andamento",
  aguardando_correcao: "Aguardando correção",
  atrasado: "Atrasado",
  concluido: "Concluído",
  a_vencer: "A vencer",
  vencido: "Vencido",
  reprovado: "Reprovado",
  isento: "Isento",
  cancelado: "Cancelado",
  nao_aplicavel: "Não aplicável",
  no_show: "Ausente",
};

export const TRAINING_STATUS_TONE: Record<EffTrainingStatus, "green" | "amber" | "red" | "blue" | "gray" | "purple"> = {
  nao_iniciado: "gray",
  em_andamento: "blue",
  aguardando_correcao: "purple",
  atrasado: "red",
  concluido: "green",
  a_vencer: "amber",
  vencido: "red",
  reprovado: "red",
  isento: "gray",
  cancelado: "gray",
  nao_aplicavel: "gray",
  no_show: "red",
};

/** Conta como pendência de conformidade: obrigatório que não está em dia. */
export function contaComoPendente(eff: EffTrainingStatus): boolean {
  return eff === "nao_iniciado" || eff === "em_andamento" || eff === "atrasado"
    || eff === "vencido" || eff === "reprovado" || eff === "no_show"
    || eff === "aguardando_correcao";
}

/** Está em dia para fins de conformidade (concluído dentro da validade, ou isento). */
export function contaComoEmDia(eff: EffTrainingStatus): boolean {
  return eff === "concluido" || eff === "a_vencer" || eff === "isento";
}

/** Fora da conta: não é falha de ninguém. */
export function foraDaConta(eff: EffTrainingStatus): boolean {
  return eff === "cancelado" || eff === "nao_aplicavel";
}

export const PERIODICIDADE_OPCOES: [number | null, string][] = [
  [null, "Avulso (não recicla)"],
  [1, "Mensal"],
  [3, "Trimestral"],
  [6, "Semestral"],
  [12, "Anual"],
  [24, "Bianual"],
  [36, "Trianual"],
  [60, "Quinquenal"],
];

export const periodicidadeLabel = (meses: number | null): string =>
  PERIODICIDADE_OPCOES.find(([v]) => v === meses)?.[1]
    ?? (meses ? `A cada ${meses} meses` : "Avulso");

export const DELIVERY_LABEL: Record<Enums<"training_delivery">, string> = {
  auto_instrucional: "Auto instrucional",
  turma: "Turma com instrutor",
  misto: "Misto",
};

/** carga horária em texto curto: 480 minutos vira "8h" */
export function cargaHoraria(minutos: number): string {
  if (!minutos) return "—";
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}
