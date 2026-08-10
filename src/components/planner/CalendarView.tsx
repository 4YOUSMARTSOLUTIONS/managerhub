"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { BoardTask } from "@/components/planner/BoardView";

/**
 * O quadro visto pelo prazo: grade mensal, um chip por tarefa no dia do
 * vencimento. Tarefa sem prazo não aparece — o calendário responde "o que
 * vence quando", e o que não vence não tem onde morar aqui.
 *
 * Cada célula mostra até 3 chips; o resto vira "+N", que expande A CÉLULA (não
 * um popover): num dia carregado a pessoa quer ler a lista inteira no lugar,
 * não caçar um balão flutuante.
 */

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const VISIVEIS = 3;

const pad = (n: number) => String(n).padStart(2, "0");

export function CalendarView({
  tasks, hoje, onOpenTask,
}: {
  tasks: BoardTask[];
  hoje: string;
  onOpenTask: (task: BoardTask) => void;
}) {
  const [ano, setAno] = useState(() => Number(hoje.slice(0, 4)));
  const [mes, setMes] = useState(() => Number(hoje.slice(5, 7))); // 1-12
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const porDia = useMemo(() => {
    const m = new Map<string, BoardTask[]>();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const arr = m.get(t.dueDate) ?? [];
      arr.push(t);
      m.set(t.dueDate, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
    return m;
  }, [tasks]);

  const navegar = (delta: number) => {
    setExpandidos(new Set());
    const novo = mes + delta;
    if (novo < 1) { setMes(12); setAno((a) => a - 1); }
    else if (novo > 12) { setMes(1); setAno((a) => a + 1); }
    else setMes(novo);
  };

  // a grade: começa no domingo da semana do dia 1, seis linhas fixas
  const celulas = useMemo(() => {
    const primeiro = new Date(Date.UTC(ano, mes - 1, 1, 12));
    const inicio = new Date(primeiro);
    inicio.setUTCDate(inicio.getUTCDate() - inicio.getUTCDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(inicio);
      d.setUTCDate(d.getUTCDate() + i);
      return {
        iso: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
        dia: d.getUTCDate(),
        doMes: d.getUTCMonth() === mes - 1,
      };
    });
  }, [ano, mes]);

  const semPrazo = tasks.filter((t) => !t.dueDate).length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.7rem" }}>
        <button type="button" className="icon-btn" title="Mês anterior" onClick={() => navegar(-1)}><ChevronLeft size={16} /></button>
        <strong style={{ fontSize: "0.95rem", minWidth: 170, textAlign: "center" }}>{MESES[mes - 1]} de {ano}</strong>
        <button type="button" className="icon-btn" title="Próximo mês" onClick={() => navegar(1)}><ChevronRight size={16} /></button>
        {semPrazo > 0 && <span className="soft" style={{ fontSize: "0.78rem", marginLeft: "auto" }}>{semPrazo} tarefa(s) sem prazo fora do calendário</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {DIAS_SEMANA.map((d) => (
          <div key={d} className="soft" style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", padding: "0.2rem 0.35rem" }}>{d}</div>
        ))}
        {celulas.map((c) => {
          const doDia = porDia.get(c.iso) ?? [];
          const aberto = expandidos.has(c.iso);
          const mostrar = aberto ? doDia : doDia.slice(0, VISIVEIS);
          const escondidas = doDia.length - mostrar.length;
          const ehHoje = c.iso === hoje;
          return (
            <div
              key={c.iso}
              style={{
                minHeight: 92, borderRadius: "var(--mh-radius-sm)",
                border: `1px solid ${ehHoje ? "var(--mh-primary-500)" : "var(--border)"}`,
                background: c.doMes ? "var(--mh-surface-1)" : "var(--mh-surface-2)",
                opacity: c.doMes ? 1 : 0.55,
                padding: "0.3rem", display: "flex", flexDirection: "column", gap: 3,
              }}
            >
              <span style={{ fontSize: "0.72rem", fontWeight: ehHoje ? 700 : 500, color: ehHoje ? "var(--mh-primary-500)" : "var(--text-muted)" }}>{c.dia}</span>
              {mostrar.map((t) => {
                const atrasada = t.progress !== "done" && t.dueDate! < hoje;
                const feita = t.progress === "done";
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onOpenTask(t)}
                    title={t.title}
                    style={{
                      textAlign: "left", fontSize: "0.7rem", lineHeight: 1.25, padding: "0.15rem 0.3rem",
                      borderRadius: 4, border: "none", cursor: "pointer",
                      background: feita ? "var(--mh-success-soft)" : atrasada ? "var(--mh-danger-soft)" : "var(--mh-primary-soft)",
                      color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      textDecoration: feita ? "line-through" : undefined,
                    }}
                  >
                    {t.title}
                  </button>
                );
              })}
              {escondidas > 0 && (
                <button type="button" className="soft" style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.7rem", textAlign: "left", padding: "0 0.3rem" }}
                  onClick={() => setExpandidos((s) => new Set(s).add(c.iso))}>
                  +{escondidas}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
