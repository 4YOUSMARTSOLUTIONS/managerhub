"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Users, Pencil, Trash2, Plus } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Dropdown, ItemDeMenu } from "@/components/ui/Dropdown";
import { PeoplePicker } from "@/components/PeoplePicker";
import { confirmDialog } from "@/components/ui/confirm";
import { BoardView, type BoardBucket, type BoardTask } from "@/components/planner/BoardView";
import {
  createBoard, updateBoard, deleteBoard, setBoardMembers,
  createBucket, renameBucket, deleteBucket, moveBucket,
  createTask, updateTask, deleteTask, toggleTaskComplete, moveTask,
} from "@/lib/actions/planner";
import { posicaoEntre, posicaoNoFim } from "@/lib/planner-position";
import { PRIORITY } from "@/lib/constants";
import type { Enums } from "@/types/database";

/**
 * A casca do Planner: seleção de quadro, filtro do gestor, diálogos e o estado
 * OTIMISTA do arraste.
 *
 * O arraste aplica a mudança no estado local no mesmo quadro de renderização e
 * só então chama o servidor; o erro reverte e explica. Sem isso o cartão
 * "voltava" por meio segundo a cada movimento, esperando o refresh, e a
 * sensação era de arraste quebrado. A posição otimista usa a MESMA conta do
 * servidor (`planner-position.ts`), então o refresh chega e nada pula.
 */

export type BoardListItem = {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  creatorName: string;
  memberIds: string[];
  participo: boolean;
};

type Pessoa = { id: string; name: string };

export function PlannerManager({
  boards, selectedBoardId, buckets, tasks, participantes, people, currentUserId, teamOptions, equipe,
}: {
  boards: BoardListItem[];
  selectedBoardId: string | null;
  buckets: BoardBucket[];
  tasks: BoardTask[];
  /** participantes do quadro aberto: os únicos elegíveis a responsável */
  participantes: Pessoa[];
  /** empresa inteira: para convidar */
  people: Pessoa[];
  currentUserId: string;
  /** subordinados do usuário; vazio para quem não é gestor */
  teamOptions: Pessoa[];
  equipe: string;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();

  const quadro = boards.find((b) => b.id === selectedBoardId) ?? null;
  const souDono = quadro?.createdBy === currentUserId;
  const canEdit = !!quadro?.participo;

  // ---------- estado otimista do quadro ----------
  const [tasksLocal, setTasksLocal] = useState<BoardTask[]>(tasks);
  const [bucketsLocal, setBucketsLocal] = useState<BoardBucket[]>(buckets);
  useEffect(() => setTasksLocal(tasks), [tasks]);
  useEffect(() => setBucketsLocal(buckets), [buckets]);

  // ---------- diálogos ----------
  const [boardDialog, setBoardDialog] = useState<null | { id?: string; name: string; description: string; memberIds: string[] }>(null);
  const [membrosOpen, setMembrosOpen] = useState(false);
  const [membrosDraft, setMembrosDraft] = useState<string[]>([]);
  const [bucketDialog, setBucketDialog] = useState<null | { id?: string; name: string }>(null);
  const [taskDialog, setTaskDialog] = useState<null | {
    id?: string; bucketId: string; title: string; description: string;
    dueDate: string; priority: Enums<"priority_level"> | ""; assigneeIds: string[];
  }>(null);
  const [erroDialog, setErroDialog] = useState("");

  const irPara = (params: { quadro?: string | null; equipe?: string | null }) => {
    const q = new URLSearchParams();
    const quadroAlvo = params.quadro === undefined ? selectedBoardId : params.quadro;
    const equipeAlvo = params.equipe === undefined ? equipe : params.equipe;
    if (quadroAlvo) q.set("quadro", quadroAlvo);
    if (equipeAlvo) q.set("equipe", equipeAlvo);
    router.push(`/planner${q.size ? `?${q}` : ""}`);
  };

  const rodar = (fn: () => Promise<{ error?: string }>, aoFalhar?: () => void) => {
    iniciar(async () => {
      const res = await fn();
      if (res?.error) {
        aoFalhar?.();
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  };

  // ---------- movimentação otimista ----------
  function moverCartao(taskId: string, toBucketId: string, afterTaskId: string | null) {
    const antes = tasksLocal;
    const doDestino = tasksLocal
      .filter((t) => t.bucketId === toBucketId && t.id !== taskId)
      .sort((a, b) => a.position - b.position);
    let pos: number | null;
    if (afterTaskId == null) {
      pos = posicaoEntre(null, doDestino[0]?.position ?? null);
    } else {
      const i = doDestino.findIndex((t) => t.id === afterTaskId);
      pos = i === -1
        ? posicaoNoFim(doDestino.map((t) => t.position))
        : posicaoEntre(doDestino[i].position, doDestino[i + 1]?.position ?? null);
    }
    // colisão local: o servidor renormaliza; aqui basta uma posição plausível
    // para o cartão não piscar, e o refresh acerta o resto
    const posOtimista = pos ?? (doDestino[doDestino.length - 1]?.position ?? 0) + 1;
    setTasksLocal((atual) => atual.map((t) => (t.id === taskId ? { ...t, bucketId: toBucketId, position: posOtimista } : t)));
    rodar(() => moveTask(taskId, toBucketId, afterTaskId), () => setTasksLocal(antes));
  }

  function alternarConclusao(task: BoardTask) {
    const antes = tasksLocal;
    const done = !task.completedAt;
    setTasksLocal((atual) => atual.map((t) => (t.id === task.id ? { ...t, completedAt: done ? new Date().toISOString() : null } : t)));
    rodar(() => toggleTaskComplete(task.id, done), () => setTasksLocal(antes));
  }

  function moverColuna(bucket: BoardBucket, direcao: -1 | 1) {
    const ordenadas = [...bucketsLocal].sort((a, b) => a.position - b.position);
    const i = ordenadas.findIndex((b) => b.id === bucket.id);
    const j = i + direcao;
    if (j < 0 || j >= ordenadas.length) return;
    // "depois de quem" na lista SEM a própria coluna
    const sem = ordenadas.filter((b) => b.id !== bucket.id);
    const after = j === 0 ? null : sem[j - 1].id;
    const antes = bucketsLocal;
    const pos = after == null
      ? posicaoEntre(null, sem[0]?.position ?? null)
      : posicaoEntre(sem[j - 1].position, sem[j]?.position ?? null);
    setBucketsLocal((atual) => atual.map((b) => (b.id === bucket.id ? { ...b, position: pos ?? b.position } : b)));
    rodar(() => moveBucket(bucket.id, after), () => setBucketsLocal(antes));
  }

  // ---------- envio dos diálogos ----------
  function salvarQuadro() {
    if (!boardDialog) return;
    setErroDialog("");
    iniciar(async () => {
      const res = boardDialog.id
        ? await updateBoard({ boardId: boardDialog.id, name: boardDialog.name, description: boardDialog.description })
        : await createBoard({ name: boardDialog.name, description: boardDialog.description, memberIds: boardDialog.memberIds });
      if (res?.error) { setErroDialog(res.error); return; }
      setBoardDialog(null);
      const novoId = !boardDialog.id && "boardId" in res ? (res as { boardId?: string }).boardId : undefined;
      if (novoId) irPara({ quadro: novoId });
      router.refresh();
    });
  }

  function salvarMembros() {
    if (!quadro) return;
    setErroDialog("");
    iniciar(async () => {
      const res = await setBoardMembers(quadro.id, membrosDraft);
      if (res?.error) { setErroDialog(res.error); return; }
      setMembrosOpen(false);
      router.refresh();
    });
  }

  function salvarColuna() {
    if (!bucketDialog || !quadro) return;
    setErroDialog("");
    iniciar(async () => {
      const res = bucketDialog.id
        ? await renameBucket(bucketDialog.id, bucketDialog.name)
        : await createBucket(quadro.id, bucketDialog.name);
      if (res?.error) { setErroDialog(res.error); return; }
      setBucketDialog(null);
      router.refresh();
    });
  }

  function salvarTarefa() {
    if (!taskDialog) return;
    setErroDialog("");
    iniciar(async () => {
      const input = {
        title: taskDialog.title,
        description: taskDialog.description,
        due_date: taskDialog.dueDate || null,
        priority: taskDialog.priority || null,
        assigneeIds: taskDialog.assigneeIds,
      };
      const res = taskDialog.id ? await updateTask(taskDialog.id, input) : await createTask(taskDialog.bucketId, input);
      if (res?.error) { setErroDialog(res.error); return; }
      setTaskDialog(null);
      router.refresh();
    });
  }

  async function excluirQuadro() {
    if (!quadro) return;
    const ok = await confirmDialog({
      title: "Excluir quadro",
      message: `Excluir "${quadro.name}"? Todas as colunas e tarefas vão junto. Esta ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (!ok) return;
    iniciar(async () => {
      const res = await deleteBoard(quadro.id);
      if (res?.error) { toast.error(res.error); return; }
      irPara({ quadro: null });
      router.refresh();
    });
  }

  async function excluirColuna(bucket: BoardBucket) {
    const ok = await confirmDialog({
      title: "Excluir coluna",
      message: `Excluir a coluna "${bucket.name}"?`,
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (!ok) return;
    rodar(() => deleteBucket(bucket.id));
  }

  async function excluirTarefa(taskId: string, titulo: string) {
    const ok = await confirmDialog({
      title: "Excluir tarefa",
      message: `Excluir "${titulo}"?`,
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (!ok) return;
    setTaskDialog(null);
    rodar(() => deleteTask(taskId));
  }

  const meusQuadros = useMemo(() => boards.filter((b) => b.participo), [boards]);
  const daEquipe = useMemo(() => boards.filter((b) => !b.participo), [boards]);

  return (
    <div style={{ opacity: pendente ? 0.85 : 1 }}>
      {/* barra de controle: quadro, gestão do quadro, filtro do gestor */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <Dropdown
          rotulo={quadro ? quadro.name : "Escolher quadro"}
          icone={<ChevronDown size={14} />}
          largura={300}
          titulo="Quadros"
        >
          {(fechar) => (
            <>
              {meusQuadros.length > 0 && <Grupo titulo="Meus quadros" />}
              {meusQuadros.map((b) => (
                <ItemDeMenu key={b.id} onClick={() => { fechar(); irPara({ quadro: b.id }); }}>
                  <span style={{ fontWeight: b.id === selectedBoardId ? 700 : 400 }}>{b.name}</span>
                </ItemDeMenu>
              ))}
              {daEquipe.length > 0 && <Grupo titulo="Da equipe (consulta)" />}
              {daEquipe.map((b) => (
                <ItemDeMenu key={b.id} onClick={() => { fechar(); irPara({ quadro: b.id }); }}>
                  <span style={{ fontWeight: b.id === selectedBoardId ? 700 : 400 }}>{b.name}</span>
                  <span className="soft" style={{ marginLeft: "auto", fontSize: "0.72rem" }}>{b.creatorName}</span>
                </ItemDeMenu>
              ))}
              {boards.length === 0 && <div className="soft" style={{ padding: "0.5rem 0.6rem", fontSize: "0.84rem" }}>Nenhum quadro ainda.</div>}
            </>
          )}
        </Dropdown>

        {souDono && quadro && (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setErroDialog(""); setMembrosDraft(quadro.memberIds); setMembrosOpen(true); }}>
              <Users size={14} /> Participantes{quadro.memberIds.length > 0 ? ` (${quadro.memberIds.length + 1})` : ""}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setErroDialog(""); setBoardDialog({ id: quadro.id, name: quadro.name, description: quadro.description ?? "", memberIds: [] }); }}>
              <Pencil size={14} /> Renomear
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={excluirQuadro}>
              <Trash2 size={14} /> Excluir
            </button>
          </>
        )}
        {canEdit && quadro && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setErroDialog(""); setBucketDialog({ name: "" }); }}>
            <Plus size={14} /> Nova coluna
          </button>
        )}

        <div style={{ marginLeft: "auto", display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          {teamOptions.length > 0 && (
            <select
              className="select"
              value={equipe}
              onChange={(e) => irPara({ equipe: e.target.value || null, quadro: null })}
              style={{ width: 220, padding: "0.4rem 0.7rem", fontSize: "0.85rem" }}
              title="Quadros em que este colaborador participa"
            >
              <option value="">Todos os quadros que vejo</option>
              {/* o gestor também é gente: sem esta opção ele filtra qualquer
                  subordinado, mas não consegue isolar os próprios quadros */}
              <option value={currentUserId}>Meus quadros</option>
              {teamOptions.map((p) => <option key={p.id} value={p.id}>Quadros de: {p.name}</option>)}
            </select>
          )}
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { setErroDialog(""); setBoardDialog({ name: "", description: "", memberIds: [] }); }}>
            + Novo quadro
          </button>
        </div>
      </div>

      {/* quem chegou pelo filtro do gestor está em consulta, e a tela diz isso
          em vez de parecer um quadro quebrado sem botões */}
      {quadro && !canEdit && (
        <div className="card" style={{ padding: "0.6rem 0.95rem", marginBottom: "0.9rem", fontSize: "0.84rem", borderLeft: "3px solid var(--mh-primary-500)" }}>
          <strong>Somente consulta.</strong>{" "}
          <span className="muted">Quadro de {quadro.creatorName}. Você o vê como gestor; para editar, peça para ser incluído como participante.</span>
        </div>
      )}

      {!quadro ? (
          <EmptyState
            title="Nenhum quadro por aqui"
            description={equipe ? "Este colaborador ainda não participa de nenhum quadro." : "Crie o primeiro quadro para organizar as atividades da sua equipe."}
            action={!equipe ? <button type="button" className="btn btn-primary" onClick={() => setBoardDialog({ name: "", description: "", memberIds: [] })}>+ Novo quadro</button> : undefined}
          />
        ) : (
          <BoardView
            buckets={bucketsLocal}
            tasks={tasksLocal}
            canEdit={canEdit}
            onMoveTask={moverCartao}
            onOpenTask={(t) => {
              if (!canEdit) return;
              setErroDialog("");
              setTaskDialog({
                id: t.id, bucketId: t.bucketId, title: t.title, description: t.description ?? "",
                dueDate: t.dueDate ?? "", priority: t.priority ?? "", assigneeIds: t.assignees.map((a) => a.id),
              });
            }}
            onToggleComplete={alternarConclusao}
            onAddTask={(bucketId) => { setErroDialog(""); setTaskDialog({ bucketId, title: "", description: "", dueDate: "", priority: "", assigneeIds: [] }); }}
            onRenameBucket={(b) => { setErroDialog(""); setBucketDialog({ id: b.id, name: b.name }); }}
            onDeleteBucket={excluirColuna}
            onMoveBucket={moverColuna}
          />
      )}

      {/* ---------------- diálogos ---------------- */}
      {boardDialog && (
        <Modal titulo={boardDialog.id ? "Renomear quadro" : "Novo quadro"} onClose={() => setBoardDialog(null)}
          footer={<>
            <button type="button" className="btn btn-ghost" onClick={() => setBoardDialog(null)}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={pendente || !boardDialog.name.trim()} onClick={salvarQuadro}>{pendente ? "Salvando…" : "Salvar"}</button>
          </>}
        >
          <label className="label">Nome do quadro</label>
          <input className="input" autoFocus value={boardDialog.name} onChange={(e) => setBoardDialog((d) => (d ? { ...d, name: e.target.value } : d))} placeholder="Ex.: Projetos do setor" />
          <label className="label" style={{ marginTop: "0.8rem" }}>Descrição (opcional)</label>
          <input className="input" value={boardDialog.description} onChange={(e) => setBoardDialog((d) => (d ? { ...d, description: e.target.value } : d))} />
          {!boardDialog.id && (
            <div style={{ marginTop: "0.8rem" }}>
              <label className="label">Participantes</label>
              <PeoplePicker
                people={people.filter((p) => p.id !== currentUserId)}
                selected={boardDialog.memberIds}
                onChange={(ids) => setBoardDialog((d) => (d ? { ...d, memberIds: ids } : d))}
                placeholder="Convidar colegas…"
              />
              <p className="muted" style={{ fontSize: "0.78rem", margin: "0.4rem 0 0" }}>Só os participantes veem e editam o quadro. Dá para mudar depois.</p>
            </div>
          )}
          {erroDialog && <ErroLinha msg={erroDialog} />}
        </Modal>
      )}

      {membrosOpen && quadro && (
        <Modal titulo={`Participantes · ${quadro.name}`} onClose={() => setMembrosOpen(false)}
          footer={<>
            <button type="button" className="btn btn-ghost" onClick={() => setMembrosOpen(false)}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={pendente} onClick={salvarMembros}>{pendente ? "Salvando…" : "Salvar"}</button>
          </>}
        >
          <p className="muted" style={{ fontSize: "0.84rem", margin: "0 0 0.7rem" }}>
            Você é o dono e participa sempre. Quem sai da lista perde o acesso ao quadro.
          </p>
          <PeoplePicker
            people={people.filter((p) => p.id !== currentUserId)}
            selected={membrosDraft}
            onChange={setMembrosDraft}
            placeholder="Convidar colegas…"
          />
          {erroDialog && <ErroLinha msg={erroDialog} />}
        </Modal>
      )}

      {bucketDialog && (
        <Modal titulo={bucketDialog.id ? "Renomear coluna" : "Nova coluna"} onClose={() => setBucketDialog(null)}
          footer={<>
            <button type="button" className="btn btn-ghost" onClick={() => setBucketDialog(null)}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={pendente || !bucketDialog.name.trim()} onClick={salvarColuna}>{pendente ? "Salvando…" : "Salvar"}</button>
          </>}
        >
          <label className="label">Nome da coluna</label>
          <input className="input" autoFocus value={bucketDialog.name}
            onChange={(e) => setBucketDialog((d) => (d ? { ...d, name: e.target.value } : d))}
            onKeyDown={(e) => { if (e.key === "Enter" && bucketDialog.name.trim()) salvarColuna(); }}
            placeholder="Ex.: Em revisão" />
          {erroDialog && <ErroLinha msg={erroDialog} />}
        </Modal>
      )}

      {taskDialog && (
        <Modal titulo={taskDialog.id ? "Editar tarefa" : "Nova tarefa"} onClose={() => setTaskDialog(null)}
          footer={<>
            {taskDialog.id && (
              <button type="button" className="btn btn-ghost" style={{ marginRight: "auto", color: "var(--mh-danger)" }}
                onClick={() => excluirTarefa(taskDialog.id!, taskDialog.title)}>
                Excluir
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => setTaskDialog(null)}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={pendente || !taskDialog.title.trim()} onClick={salvarTarefa}>{pendente ? "Salvando…" : "Salvar"}</button>
          </>}
        >
          <label className="label">Título</label>
          <input className="input" autoFocus value={taskDialog.title} onChange={(e) => setTaskDialog((d) => (d ? { ...d, title: e.target.value } : d))} placeholder="O que precisa ser feito?" />
          <label className="label" style={{ marginTop: "0.8rem" }}>Descrição (opcional)</label>
          <textarea className="input" rows={3} value={taskDialog.description} onChange={(e) => setTaskDialog((d) => (d ? { ...d, description: e.target.value } : d))} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem", marginTop: "0.8rem" }}>
            <div>
              <label className="label">Prazo</label>
              <input type="date" className="input" value={taskDialog.dueDate} onChange={(e) => setTaskDialog((d) => (d ? { ...d, dueDate: e.target.value } : d))} />
            </div>
            <div>
              <label className="label">Prioridade</label>
              <select className="select" value={taskDialog.priority} onChange={(e) => setTaskDialog((d) => (d ? { ...d, priority: e.target.value as Enums<"priority_level"> | "" } : d))}>
                <option value="">Sem prioridade</option>
                {(Object.keys(PRIORITY) as Enums<"priority_level">[]).map((p) => <option key={p} value={p}>{PRIORITY[p]}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: "0.8rem" }}>
            <label className="label">Responsáveis</label>
            <PeoplePicker
              people={participantes}
              selected={taskDialog.assigneeIds}
              onChange={(ids) => setTaskDialog((d) => (d ? { ...d, assigneeIds: ids } : d))}
              placeholder="Participantes do quadro…"
            />
          </div>
          {erroDialog && <ErroLinha msg={erroDialog} />}
        </Modal>
      )}
    </div>
  );
}

function Grupo({ titulo }: { titulo: string }) {
  return (
    <div className="soft" style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", padding: "0.35rem 0.6rem 0.15rem" }}>
      {titulo}
    </div>
  );
}

function ErroLinha({ msg }: { msg: string }) {
  return <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: "0.6rem 0 0" }}>{msg}</p>;
}

/** Overlay padrão da casa: fecha pelo X e pelo Cancelar, NUNCA pelo clique fora. */
function Modal({ titulo, onClose, children, footer }: {
  titulo: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3,6,14,0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "7vh 1rem", zIndex: 70, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 520, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>{titulo}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>
        <div style={{ padding: "1.1rem 1.25rem" }}>{children}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "0.9rem 1.25rem", borderTop: "1px solid var(--border)" }}>{footer}</div>
      </div>
    </div>
  );
}
