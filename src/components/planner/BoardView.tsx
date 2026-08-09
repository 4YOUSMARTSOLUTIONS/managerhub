"use client";

import { useMemo, useRef, useState } from "react";
import { CheckCircle2, Circle, GripVertical, MoreHorizontal, Pencil, Trash2, ArrowLeftRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Dropdown, ItemDeMenu } from "@/components/ui/Dropdown";
import { PRIORITY, PRIORITY_TONE } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { Enums } from "@/types/database";

/**
 * O quadro em si: colunas lado a lado, cartões arrastáveis.
 *
 * O arraste é HTML5 nativo (dataTransfer), sem lib: é a única parte do sistema
 * que precisa de drag e uma dependência inteira por isso não se paga. O preço
 * conhecido é que drag HTML5 NÃO dispara em touch, então todo cartão carrega o
 * menu "Mover para", que é o caminho no celular e no teclado. O arraste é o
 * atalho, nunca o único caminho.
 *
 * Este componente não fala com o servidor: recebe callbacks. Quem decide o que
 * um drop significa (mover cartão do Planner, mudar status de Ação) é o dono.
 */

export type BoardTask = {
  id: string;
  bucketId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: Enums<"priority_level"> | null;
  completedAt: string | null;
  position: number;
  assignees: { id: string; name: string }[];
};

export type BoardBucket = { id: string; name: string; position: number };

const hojeIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function BoardView({
  buckets, tasks, canEdit,
  onMoveTask, onOpenTask, onToggleComplete, onAddTask,
  onRenameBucket, onDeleteBucket, onMoveBucket,
}: {
  buckets: BoardBucket[];
  tasks: BoardTask[];
  canEdit: boolean;
  /** afterTaskId null = topo da coluna */
  onMoveTask: (taskId: string, toBucketId: string, afterTaskId: string | null) => void;
  onOpenTask: (task: BoardTask) => void;
  onToggleComplete: (task: BoardTask) => void;
  onAddTask: (bucketId: string) => void;
  onRenameBucket: (bucket: BoardBucket) => void;
  onDeleteBucket: (bucket: BoardBucket) => void;
  /** direcao -1 = uma posição à esquerda, +1 à direita */
  onMoveBucket: (bucket: BoardBucket, direcao: -1 | 1) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  // onde a linha de inserção aparece: coluna + índice do vão
  const [alvo, setAlvo] = useState<{ bucketId: string; index: number } | null>(null);
  // dragover dispara dezenas de vezes por segundo; o ref evita re-render à toa
  const alvoRef = useRef<typeof alvo>(null);

  const ordenadas = useMemo(() => [...buckets].sort((a, b) => a.position - b.position), [buckets]);
  const porColuna = useMemo(() => {
    const m = new Map<string, BoardTask[]>();
    for (const b of buckets) m.set(b.id, []);
    for (const t of tasks) {
      const arr = m.get(t.bucketId);
      if (arr) arr.push(t);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.position - b.position);
    return m;
  }, [buckets, tasks]);

  const setAlvoSePreciso = (novo: { bucketId: string; index: number } | null) => {
    const igual = novo?.bucketId === alvoRef.current?.bucketId && novo?.index === alvoRef.current?.index;
    if (igual) return;
    alvoRef.current = novo;
    setAlvo(novo);
  };

  /** em qual vão da coluna o mouse está, pelos centros dos cartões */
  const indiceDoMouse = (e: React.DragEvent, colEl: HTMLElement): number => {
    const cards = [...colEl.querySelectorAll<HTMLElement>("[data-card-id]")];
    let i = 0;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (e.clientY > r.top + r.height / 2) i++;
    }
    return i;
  };

  const soltar = (bucketId: string) => {
    const id = dragId;
    const pos = alvoRef.current;
    setDragId(null);
    setAlvoSePreciso(null);
    if (!id || !pos || pos.bucketId !== bucketId) return;
    const lista = (porColuna.get(bucketId) ?? []).filter((t) => t.id !== id);
    // o índice é do VÃO: 0 = topo (after null); n = depois do (n-1)-ésimo
    const after = pos.index === 0 ? null : lista[Math.min(pos.index, lista.length) - 1]?.id ?? null;
    onMoveTask(id, bucketId, after);
  };

  return (
    <div style={{ display: "flex", gap: "0.9rem", alignItems: "flex-start", overflowX: "auto", paddingBottom: "0.75rem" }}>
      {ordenadas.map((b, bi) => {
        const doBucket = porColuna.get(b.id) ?? [];
        return (
          <div
            key={b.id}
            style={{
              minWidth: 292, width: 292, flexShrink: 0,
              background: "var(--mh-surface-2)", borderRadius: "var(--mh-radius-lg)",
              border: "1px solid var(--border)", padding: "0.6rem",
              display: "flex", flexDirection: "column", gap: "0.5rem",
            }}
            onDragOver={(e) => {
              if (!canEdit || !dragId) return;
              e.preventDefault(); // sem isto o drop não acontece
              e.dataTransfer.dropEffect = "move";
              setAlvoSePreciso({ bucketId: b.id, index: indiceDoMouse(e, e.currentTarget) });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setAlvoSePreciso(null);
            }}
            onDrop={(e) => { e.preventDefault(); soltar(b.id); }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0 0.2rem" }}>
              <strong style={{ fontSize: "0.88rem", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</strong>
              <span className="soft" style={{ fontSize: "0.75rem" }}>{doBucket.length}</span>
              {canEdit && (
                <Dropdown rotulo="" icone={<MoreHorizontal size={15} />} largura={210} alinharDireita>
                  {(fechar) => (
                    <>
                      <ItemDeMenu onClick={() => { fechar(); onRenameBucket(b); }}><Pencil size={14} style={{ marginRight: 8 }} /> Renomear coluna</ItemDeMenu>
                      <ItemDeMenu disabled={bi === 0} onClick={() => { fechar(); onMoveBucket(b, -1); }}><ArrowLeftRight size={14} style={{ marginRight: 8 }} /> Mover à esquerda</ItemDeMenu>
                      <ItemDeMenu disabled={bi === ordenadas.length - 1} onClick={() => { fechar(); onMoveBucket(b, 1); }}><ArrowLeftRight size={14} style={{ marginRight: 8 }} /> Mover à direita</ItemDeMenu>
                      <ItemDeMenu disabled={doBucket.length > 0} titulo={doBucket.length > 0 ? "Mova os cartões antes" : undefined} onClick={() => { fechar(); onDeleteBucket(b); }}>
                        <Trash2 size={14} style={{ marginRight: 8 }} /> Excluir coluna
                      </ItemDeMenu>
                    </>
                  )}
                </Dropdown>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", minHeight: 8 }}>
              {doBucket.map((t, i) => (
                <div key={t.id}>
                  {alvo?.bucketId === b.id && alvo.index === i && dragId !== t.id && <LinhaDeInsercao />}
                  <Cartao
                    task={t}
                    canEdit={canEdit}
                    arrastando={dragId === t.id}
                    buckets={ordenadas}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", t.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(t.id);
                    }}
                    onDragEnd={() => { setDragId(null); setAlvoSePreciso(null); }}
                    onOpen={() => onOpenTask(t)}
                    onToggle={() => onToggleComplete(t)}
                    onMoveTo={(bucketId) => {
                      const destino = porColuna.get(bucketId) ?? [];
                      onMoveTask(t.id, bucketId, destino[destino.length - 1]?.id ?? null);
                    }}
                  />
                </div>
              ))}
              {alvo?.bucketId === b.id && alvo.index >= doBucket.length && dragId && <LinhaDeInsercao />}
            </div>

            {canEdit && (
              <button type="button" className="btn btn-ghost btn-sm" style={{ justifyContent: "flex-start" }} onClick={() => onAddTask(b.id)}>
                + Adicionar tarefa
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LinhaDeInsercao() {
  return <div style={{ height: 3, borderRadius: 2, background: "var(--mh-primary-500)", margin: "0.1rem 0.2rem 0.35rem" }} />;
}

function Cartao({
  task, canEdit, arrastando, buckets,
  onDragStart, onDragEnd, onOpen, onToggle, onMoveTo,
}: {
  task: BoardTask;
  canEdit: boolean;
  arrastando: boolean;
  buckets: BoardBucket[];
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onToggle: () => void;
  onMoveTo: (bucketId: string) => void;
}) {
  const feita = !!task.completedAt;
  const atrasada = !feita && !!task.dueDate && task.dueDate < hojeIso();
  return (
    <div
      data-card-id={task.id}
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="card"
      style={{
        padding: "0.6rem 0.65rem", cursor: canEdit ? "grab" : "pointer",
        opacity: arrastando ? 0.4 : feita ? 0.72 : 1,
        display: "flex", flexDirection: "column", gap: "0.4rem",
      }}
      onClick={onOpen}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.45rem" }}>
        {canEdit && (
          <button
            type="button"
            className="icon-btn"
            title={feita ? "Marcar como não concluída" : "Marcar como concluída"}
            style={{ padding: 2, flexShrink: 0, color: feita ? "var(--mh-success)" : undefined }}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
          >
            {feita ? <CheckCircle2 size={17} /> : <Circle size={17} />}
          </button>
        )}
        <span style={{ fontSize: "0.86rem", fontWeight: 600, lineHeight: 1.35, flex: 1, minWidth: 0, textDecoration: feita ? "line-through" : undefined }}>
          {task.title}
        </span>
        {canEdit && (
          <span onClick={(e) => e.stopPropagation()}>
            <Dropdown rotulo="" icone={<GripVertical size={14} />} largura={210} alinharDireita>
              {(fechar) => (
                <>
                  <div className="soft" style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", padding: "0.25rem 0.6rem" }}>Mover para</div>
                  {buckets.filter((b) => b.id !== task.bucketId).map((b) => (
                    <ItemDeMenu key={b.id} onClick={() => { fechar(); onMoveTo(b.id); }}>{b.name}</ItemDeMenu>
                  ))}
                </>
              )}
            </Dropdown>
          </span>
        )}
      </div>
      {(task.priority || task.dueDate || task.assignees.length > 0) && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
          {task.priority && <Badge tone={PRIORITY_TONE[task.priority]}>{PRIORITY[task.priority]}</Badge>}
          {task.dueDate && (
            <span className={atrasada ? undefined : "muted"} style={{ fontSize: "0.75rem", color: atrasada ? "var(--mh-danger)" : undefined, fontWeight: atrasada ? 600 : undefined }}>
              {formatDate(task.dueDate)}
            </span>
          )}
          {task.assignees.length > 0 && (
            <span style={{ display: "inline-flex", gap: 2, marginLeft: "auto" }}>
              {task.assignees.slice(0, 3).map((a) => <Avatar key={a.id} name={a.name} userId={a.id} size={20} />)}
              {task.assignees.length > 3 && <span className="soft" style={{ fontSize: "0.72rem", alignSelf: "center" }}>+{task.assignees.length - 3}</span>}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
