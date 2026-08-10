"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PROGRESS_LABEL, PROGRESS_TONE } from "@/lib/planner-group";
import { PRIORITY, PRIORITY_TONE } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { Enums } from "@/types/database";

/**
 * Tudo que está comigo, de TODOS os quadros, num lugar só. É a tela de "o que
 * eu tenho para hoje" — sem ela, quem participa de cinco quadros abre cinco
 * telas para responder essa pergunta.
 *
 * Clicar leva ao quadro da tarefa (`?quadro=`): o cartão mora lá, com o
 * contexto, o checklist e a conversa dele.
 */

export type MinhaTarefa = {
  id: string;
  title: string;
  dueDate: string | null;
  priority: Enums<"priority_level"> | null;
  progress: Enums<"planner_progress">;
  boardId: string;
  boardName: string;
  bucketName: string;
};

export function MyTasksView({ tarefas, hoje }: { tarefas: MinhaTarefa[]; hoje: string }) {
  const router = useRouter();
  const [porQuadro, setPorQuadro] = useState(false);
  const [mostrarConcluidas, setMostrarConcluidas] = useState(false);

  const visiveis = useMemo(
    () => (mostrarConcluidas ? tarefas : tarefas.filter((t) => t.progress !== "done")),
    [tarefas, mostrarConcluidas],
  );

  const grupos = useMemo(() => {
    if (porQuadro) {
      const m = new Map<string, { label: string; tarefas: MinhaTarefa[] }>();
      for (const t of visiveis) {
        const g = m.get(t.boardId) ?? { label: t.boardName, tarefas: [] };
        g.tarefas.push(t);
        m.set(t.boardId, g);
      }
      return [...m.entries()]
        .map(([key, g]) => ({ key, ...g, tone: undefined as undefined }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    }
    const ordem: Enums<"planner_progress">[] = ["not_started", "in_progress", "done"];
    return ordem
      .map((p) => ({ key: p, label: PROGRESS_LABEL[p], tone: PROGRESS_TONE[p], tarefas: visiveis.filter((t) => t.progress === p) }))
      .filter((g) => g.tarefas.length > 0 || g.key !== "done");
  }, [visiveis, porQuadro]);

  if (tarefas.length === 0) {
    return <EmptyState title="Nada atribuído a você" description="As tarefas em que você é responsável, em qualquer quadro, aparecem aqui." />;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.8rem", flexWrap: "wrap" }}>
        <span className="soft" style={{ fontSize: "0.78rem" }}>Agrupar por</span>
        <button type="button" className={`btn btn-xs ${!porQuadro ? "btn-primary" : "btn-ghost"}`} onClick={() => setPorQuadro(false)}>Progresso</button>
        <button type="button" className={`btn btn-xs ${porQuadro ? "btn-primary" : "btn-ghost"}`} onClick={() => setPorQuadro(true)}>Quadro</button>
        <label style={{ marginLeft: "auto", display: "inline-flex", gap: "0.35rem", alignItems: "center", fontSize: "0.82rem", cursor: "pointer" }}>
          <input type="checkbox" checked={mostrarConcluidas} onChange={(e) => setMostrarConcluidas(e.target.checked)} />
          Mostrar concluídas
        </label>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {grupos.map((g) => (
          <div key={g.key}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginBottom: "0.4rem" }}>
              {g.tone ? <Badge tone={g.tone}>{g.label}</Badge> : <strong style={{ fontSize: "0.9rem" }}>{g.label}</strong>}
              <span className="soft" style={{ fontSize: "0.76rem" }}>{g.tarefas.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {g.tarefas.map((t) => {
                const atrasada = t.progress !== "done" && !!t.dueDate && t.dueDate < hoje;
                return (
                  <button
                    key={t.id}
                    type="button"
                    className="card"
                    onClick={() => router.push(`/planner?quadro=${t.boardId}`)}
                    title={`Abrir o quadro ${t.boardName}`}
                    style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.55rem 0.8rem", cursor: "pointer", textAlign: "left", border: "1px solid var(--border)", width: "100%" }}
                  >
                    <span style={{ fontSize: "0.87rem", fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: t.progress === "done" ? "line-through" : undefined }}>
                      {t.title}
                    </span>
                    {t.priority && <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY[t.priority]}</Badge>}
                    {t.dueDate && (
                      <span className={atrasada ? undefined : "muted"} style={{ fontSize: "0.76rem", color: atrasada ? "var(--mh-danger)" : undefined, fontWeight: atrasada ? 600 : undefined, whiteSpace: "nowrap" }}>
                        {formatDate(t.dueDate)}
                      </span>
                    )}
                    <span className="soft" style={{ fontSize: "0.74rem", whiteSpace: "nowrap" }}>{t.boardName} · {t.bucketName}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
