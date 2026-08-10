"use client";

import { Badge } from "@/components/ui/Badge";
import { PlannerCard, type BoardBucket, type BoardTask } from "@/components/planner/BoardView";
import type { Grupo } from "@/lib/planner-group";

/**
 * As mesmas tarefas, re-agrupadas por outro eixo (responsável, prioridade,
 * progresso, prazo). O cartão é o MESMO do quadro, só que sem arraste: no
 * agrupamento por responsável um cartão com dois responsáveis aparece duas
 * vezes, e arrastar um cartão duplicado seria ambíguo. Mover continua possível
 * pelo menu do cartão, que muda a COLUNA — o eixo do agrupamento é só leitura.
 */
export function GroupedView({
  grupos, buckets, canEdit, onOpenTask, onToggleComplete, onMoveTo, onDeleteTask,
}: {
  grupos: Grupo<BoardTask>[];
  buckets: BoardBucket[];
  canEdit: boolean;
  onOpenTask: (task: BoardTask) => void;
  onToggleComplete: (task: BoardTask) => void;
  onMoveTo: (taskId: string, bucketId: string) => void;
  onDeleteTask: (task: BoardTask) => void;
}) {
  return (
    <div style={{ display: "flex", gap: "0.9rem", alignItems: "flex-start", overflowX: "auto", paddingBottom: "0.75rem" }}>
      {grupos.map((g) => (
        <div
          key={g.key}
          style={{
            minWidth: 292, width: 292, flexShrink: 0,
            background: "var(--mh-surface-2)", borderRadius: "var(--mh-radius-lg)",
            border: "1px solid var(--border)", padding: "0.6rem",
            display: "flex", flexDirection: "column", gap: "0.5rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0 0.2rem" }}>
            {g.tone
              ? <Badge tone={g.tone}>{g.label}</Badge>
              : <strong style={{ fontSize: "0.88rem", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.label}</strong>}
            <span className="soft" style={{ fontSize: "0.75rem", marginLeft: "auto" }}>{g.tarefas.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", minHeight: 8 }}>
            {g.tarefas.map((t) => (
              <PlannerCard
                key={t.id}
                task={t}
                canEdit={canEdit}
                arrastavel={false}
                buckets={buckets}
                onOpen={() => onOpenTask(t)}
                onToggle={() => onToggleComplete(t)}
                onDelete={() => onDeleteTask(t)}
                onMoveTo={(bucketId) => onMoveTo(t.id, bucketId)}
              />
            ))}
            {g.tarefas.length === 0 && <span className="soft" style={{ fontSize: "0.78rem", padding: "0.2rem" }}>Nada aqui.</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
