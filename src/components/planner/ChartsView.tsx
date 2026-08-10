"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PROGRESS_LABEL } from "@/lib/planner-group";
import { PRIORITY, PRIORITY_TONE } from "@/lib/constants";
import type { BoardTask } from "@/components/planner/BoardView";
import type { Enums } from "@/types/database";

/**
 * O quadro em números: rosca por progresso, barras por responsável e a régua
 * de prioridades. SVG desenhado à mão sobre os tokens do sistema — três
 * gráficos não pagam uma biblioteca.
 */

const PROGRESSOS: { key: Enums<"planner_progress">; cor: string }[] = [
  { key: "not_started", cor: "var(--mh-border-strong)" },
  { key: "in_progress", cor: "var(--mh-info)" },
  { key: "done", cor: "var(--mh-success)" },
];

export function ChartsView({ tasks }: { tasks: BoardTask[] }) {
  const porProgresso = useMemo(() => {
    const m: Record<Enums<"planner_progress">, number> = { not_started: 0, in_progress: 0, done: 0 };
    for (const t of tasks) m[t.progress] += 1;
    return m;
  }, [tasks]);

  const porPessoa = useMemo(() => {
    const m = new Map<string, { nome: string; total: number; feitas: number }>();
    for (const t of tasks) {
      const alvos = t.assignees.length ? t.assignees : [{ id: "__sem", name: "Não atribuído" }];
      for (const a of alvos) {
        const x = m.get(a.id) ?? { nome: a.name, total: 0, feitas: 0 };
        x.total += 1;
        if (t.progress === "done") x.feitas += 1;
        m.set(a.id, x);
      }
    }
    return [...m.values()].sort((a, b) => b.total - a.total).slice(0, 10);
  }, [tasks]);

  const porPrioridade = useMemo(() => {
    const ordem: Enums<"priority_level">[] = ["urgent", "high", "medium", "low"];
    return ordem.map((p) => ({ p, n: tasks.filter((t) => t.priority === p).length }));
  }, [tasks]);

  if (tasks.length === 0) {
    return <EmptyState title="Nada para medir" description="Crie tarefas no quadro para os gráficos aparecerem." />;
  }

  const total = tasks.length;
  // rosca: arcos por fração, começando no topo
  const R = 54, C = 2 * Math.PI * R;
  let acumulado = 0;
  const arcos = PROGRESSOS.map(({ key, cor }) => {
    const fracao = porProgresso[key] / total;
    const arco = { cor, dash: fracao * C, offset: acumulado * C };
    acumulado += fracao;
    return arco;
  });
  const maxPessoa = Math.max(1, ...porPessoa.map((p) => p.total));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.9rem", alignItems: "start" }}>
      {/* -------------------------------------------------- rosca do progresso */}
      <div className="card" style={{ padding: "1rem" }}>
        <strong style={{ fontSize: "0.9rem" }}>Progresso</strong>
        <div style={{ display: "flex", alignItems: "center", gap: "1.1rem", marginTop: "0.7rem" }}>
          <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Distribuição por progresso">
            <g transform="rotate(-90 70 70)">
              {arcos.map((a, i) => (
                <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={a.cor} strokeWidth="18"
                  strokeDasharray={`${a.dash} ${C - a.dash}`} strokeDashoffset={-a.offset} />
              ))}
            </g>
            <text x="70" y="66" textAnchor="middle" style={{ fontSize: 22, fontWeight: 700, fill: "var(--text)" }}>{total}</text>
            <text x="70" y="84" textAnchor="middle" style={{ fontSize: 10, fill: "var(--text-muted)" }}>tarefas</text>
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            {PROGRESSOS.map(({ key, cor }) => (
              <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem" }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: cor, display: "inline-block" }} />
                {PROGRESS_LABEL[key]} <strong>{porProgresso[key]}</strong>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------ barras por pessoa */}
      <div className="card" style={{ padding: "1rem" }}>
        <strong style={{ fontSize: "0.9rem" }}>Por responsável</strong>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", marginTop: "0.7rem" }}>
          {porPessoa.map((p) => (
            <div key={p.nome}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", marginBottom: 2 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nome}</span>
                <span className="soft">{p.feitas}/{p.total}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: "var(--mh-surface-2)", overflow: "hidden", display: "flex" }}>
                <div style={{ width: `${(p.feitas / maxPessoa) * 100}%`, background: "var(--mh-success)" }} />
                <div style={{ width: `${((p.total - p.feitas) / maxPessoa) * 100}%`, background: "var(--mh-primary-500)", opacity: 0.55 }} />
              </div>
            </div>
          ))}
        </div>
        <p className="soft" style={{ fontSize: "0.72rem", margin: "0.6rem 0 0" }}>Verde = concluídas; roxo = em aberto. Cartão com dois responsáveis conta para os dois.</p>
      </div>

      {/* ------------------------------------------------------- prioridades */}
      <div className="card" style={{ padding: "1rem" }}>
        <strong style={{ fontSize: "0.9rem" }}>Prioridade</strong>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", marginTop: "0.7rem" }}>
          {porPrioridade.map(({ p, n }) => (
            <div key={p} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.84rem" }}>
              <Badge tone={PRIORITY_TONE[p]}>{PRIORITY[p]}</Badge>
              <strong style={{ marginLeft: "auto" }}>{n}</strong>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.84rem" }}>
            <span className="muted">Sem prioridade</span>
            <strong style={{ marginLeft: "auto" }}>{tasks.filter((t) => !t.priority).length}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
