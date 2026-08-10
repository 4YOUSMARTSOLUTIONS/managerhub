/**
 * Filtro e agrupamento dos cartões do Planner, no cliente.
 *
 * O quadro carrega os cartões UMA vez; filtrar e reagrupar é rearranjo do que
 * já está na memória, então mora aqui como função pura: a mesma entrada dá a
 * mesma tela, e os casos chatos (multi-responsável, sem prazo, atrasada) se
 * conferem de mesa.
 *
 * No agrupamento por RESPONSÁVEL o cartão com dois responsáveis aparece nos
 * dois grupos, como no Planner da Microsoft: o grupo responde "o que está com
 * fulano", não "onde mora o cartão". É a única visão em que a soma dos grupos
 * pode passar do total, e o arraste fica desligado fora do agrupamento por
 * coluna justamente porque mover um cartão duplicado seria ambíguo.
 */

import type { Enums } from "@/types/database";
import { PRIORITY, PRIORITY_TONE, type Tone } from "@/lib/constants";

export type Agrupamento = "coluna" | "responsavel" | "prioridade" | "progresso" | "prazo";

/** o formato mínimo que o agrupador precisa; BoardTask da tela satisfaz */
export type TarefaAgrupavel = {
  id: string;
  bucketId: string;
  title: string;
  dueDate: string | null;
  priority: Enums<"priority_level"> | null;
  progress: Enums<"planner_progress">;
  assignees: { id: string; name: string }[];
  labelIds: string[];
};

export type Grupo<T> = { key: string; label: string; tone?: Tone; tarefas: T[] };

export type FiltroPlanner = {
  texto: string;
  assigneeId: string;
  prioridade: Enums<"priority_level"> | "";
  labelId: string;
  /** "" = todas; vencidas = prazo < hoje e não concluída; semana = próximos 7 dias */
  prazo: "" | "vencidas" | "semana";
};

export const FILTRO_VAZIO: FiltroPlanner = { texto: "", assigneeId: "", prioridade: "", labelId: "", prazo: "" };

export const PROGRESS_LABEL: Record<Enums<"planner_progress">, string> = {
  not_started: "Não iniciada",
  in_progress: "Em andamento",
  done: "Concluída",
};
export const PROGRESS_TONE: Record<Enums<"planner_progress">, Tone> = {
  not_started: "gray",
  in_progress: "blue",
  done: "green",
};
export const RECURRENCE_LABEL: Record<Enums<"planner_recurrence">, string> = {
  none: "Não repete",
  daily: "Diária",
  weekly: "Semanal",
  monthly: "Mensal",
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function filtrarTarefas<T extends TarefaAgrupavel>(
  tarefas: T[],
  filtro: FiltroPlanner,
  hoje: string,
): T[] {
  const termo = norm(filtro.texto.trim());
  const fimDaSemana = (() => {
    const [a, m, d] = hoje.split("-").map(Number);
    const dt = new Date(Date.UTC(a, m - 1, d, 12));
    dt.setUTCDate(dt.getUTCDate() + 7);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  })();

  return tarefas.filter((t) => {
    if (termo && !norm(t.title).includes(termo)) return false;
    if (filtro.assigneeId && !t.assignees.some((a) => a.id === filtro.assigneeId)) return false;
    if (filtro.prioridade && t.priority !== filtro.prioridade) return false;
    if (filtro.labelId && !t.labelIds.includes(filtro.labelId)) return false;
    if (filtro.prazo === "vencidas") {
      if (!t.dueDate || t.dueDate >= hoje || t.progress === "done") return false;
    }
    if (filtro.prazo === "semana") {
      if (!t.dueDate || t.dueDate < hoje || t.dueDate > fimDaSemana) return false;
    }
    return true;
  });
}

export function agruparTarefas<T extends TarefaAgrupavel>(
  tarefas: T[],
  modo: Agrupamento,
  ctx: { buckets: { id: string; name: string; position: number }[]; hoje: string },
): Grupo<T>[] {
  if (modo === "coluna") {
    return [...ctx.buckets]
      .sort((a, b) => a.position - b.position)
      .map((b) => ({ key: b.id, label: b.name, tarefas: tarefas.filter((t) => t.bucketId === b.id) }));
  }

  if (modo === "responsavel") {
    const grupos = new Map<string, Grupo<T>>();
    const sem: Grupo<T> = { key: "__sem", label: "Não atribuído", tone: "gray", tarefas: [] };
    for (const t of tarefas) {
      if (t.assignees.length === 0) { sem.tarefas.push(t); continue; }
      for (const a of t.assignees) {
        const g = grupos.get(a.id) ?? { key: a.id, label: a.name, tarefas: [] };
        g.tarefas.push(t);
        grupos.set(a.id, g);
      }
    }
    const lista = [...grupos.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    return sem.tarefas.length ? [...lista, sem] : lista;
  }

  if (modo === "prioridade") {
    const ordem: (Enums<"priority_level"> | null)[] = ["urgent", "high", "medium", "low", null];
    return ordem
      .map((p) => ({
        key: p ?? "__sem",
        label: p ? PRIORITY[p] : "Sem prioridade",
        tone: p ? PRIORITY_TONE[p] : ("gray" as Tone),
        tarefas: tarefas.filter((t) => t.priority === p || (!t.priority && p === null)),
      }))
      .filter((g) => g.tarefas.length > 0 || g.key !== "__sem");
  }

  if (modo === "progresso") {
    const ordem: Enums<"planner_progress">[] = ["not_started", "in_progress", "done"];
    return ordem.map((p) => ({
      key: p, label: PROGRESS_LABEL[p], tone: PROGRESS_TONE[p],
      tarefas: tarefas.filter((t) => t.progress === p),
    }));
  }

  // prazo: faixas fechadas em relação a HOJE. Concluída não é "atrasada":
  // atraso é cobrança, e não se cobra o que já acabou.
  const fimDaSemana = (() => {
    const [a, m, d] = ctx.hoje.split("-").map(Number);
    const dt = new Date(Date.UTC(a, m - 1, d, 12));
    dt.setUTCDate(dt.getUTCDate() + 7);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  })();
  const faixa = (t: TarefaAgrupavel): string => {
    if (!t.dueDate) return "sem";
    if (t.dueDate < ctx.hoje) return t.progress === "done" ? "depois" : "atrasadas";
    if (t.dueDate === ctx.hoje) return "hoje";
    if (t.dueDate <= fimDaSemana) return "semana";
    return "depois";
  };
  const defs: { key: string; label: string; tone?: Tone }[] = [
    { key: "atrasadas", label: "Atrasadas", tone: "red" },
    { key: "hoje", label: "Hoje", tone: "amber" },
    { key: "semana", label: "Esta semana", tone: "blue" },
    { key: "depois", label: "Depois", tone: "gray" },
    { key: "sem", label: "Sem prazo", tone: "gray" },
  ];
  return defs.map((d) => ({ ...d, tarefas: tarefas.filter((t) => faixa(t) === d.key) }));
}
