"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Paperclip, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { PeoplePicker } from "@/components/PeoplePicker";
import { confirmDialog } from "@/components/ui/confirm";
import { createTask, updateTask, deleteTask, setTaskProgress, moveTaskToBoard, getMoveTargets, type TaskInput, type MoveTarget } from "@/lib/actions/planner";
import {
  createLabel, deleteLabel, setTaskLabels,
  addChecklistItem, toggleChecklistItem, deleteChecklistItem,
  addTaskComment, deleteTaskComment,
  uploadTaskAttachment, deleteTaskAttachment, getTaskAttachmentUrl,
  getTaskDetail, type TaskComment, type TaskEvent, type TaskAttachment,
} from "@/lib/actions/planner-detail";
import { PROGRESS_LABEL, PROGRESS_TONE, RECURRENCE_LABEL } from "@/lib/planner-group";
import { PRIORITY, type Tone } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Enums } from "@/types/database";

/**
 * A ficha completa do cartão.
 *
 * Os campos principais salvam num botão só; checklist, etiquetas, anexos e
 * comentários salvam NA HORA, item a item — são listas vivas, e "editar três
 * coisas e perder tudo no Cancelar" é o comportamento que ninguém espera de um
 * checklist. Por isso essas seções só existem no modo EDIÇÃO: um cartão que
 * ainda não foi salvo não tem onde pendurar item.
 *
 * Comentários e histórico chegam por `getTaskDetail` quando o diálogo abre
 * (paginado, mais recentes primeiro): descer isso com o quadro multiplicaria a
 * página por cartão sem ninguém ter pedido.
 */

export type BoardLabel = { id: string; name: string; color: string };
export type ChecklistItem = { id: string; title: string; done: boolean; position: number };

export type TaskSeed = {
  id?: string;
  bucketId: string;
  title: string;
  description: string;
  startDate: string;
  dueDate: string;
  priority: Enums<"priority_level"> | "";
  progress: Enums<"planner_progress">;
  recurrence: Enums<"planner_recurrence">;
  assigneeIds: string[];
  labelIds: string[];
};

const CORES: { key: string; nome: string }[] = [
  { key: "blue", nome: "Azul" }, { key: "green", nome: "Verde" }, { key: "amber", nome: "Âmbar" },
  { key: "red", nome: "Vermelho" }, { key: "purple", nome: "Roxo" }, { key: "pink", nome: "Rosa" },
  { key: "gray", nome: "Cinza" }, { key: "dark", nome: "Escuro" },
];

const EVENTO_LABEL: Record<string, string> = {
  created: "criou a tarefa",
  moved_bucket: "moveu de coluna",
  progress_changed: "mudou o progresso",
  assigned: "atribuiu responsável",
  unassigned: "removeu responsável",
  due_changed: "alterou o prazo",
  moved_board: "moveu de quadro",
};

export function TaskDialog({
  seed, boardId, checklist, boardLabels, participantes, currentUserId, onClose,
}: {
  seed: TaskSeed;
  boardId: string;
  /** itens do checklist da tarefa (vazio no modo criação) */
  checklist: ChecklistItem[];
  boardLabels: BoardLabel[];
  participantes: { id: string; name: string }[];
  currentUserId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [draft, setDraft] = useState<TaskSeed>(seed);
  const [erro, setErro] = useState("");
  const editando = !!seed.id;

  // listas vivas (edição): estado local + refresh reconcilia
  const [itens, setItens] = useState<ChecklistItem[]>(checklist);
  useEffect(() => setItens(checklist), [checklist]);
  const [novoItem, setNovoItem] = useState("");

  const [labels, setLabels] = useState<BoardLabel[]>(boardLabels);
  useEffect(() => setLabels(boardLabels), [boardLabels]);
  const [novaEtiqueta, setNovaEtiqueta] = useState<null | { nome: string; cor: string }>(null);

  // detalhe lazy
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [novoComentario, setNovoComentario] = useState("");
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // mover para outro quadro: alvos carregados só quando a pessoa pede
  const [mover, setMover] = useState<null | { boards: MoveTarget[]; boardId: string; bucketId: string }>(null);

  useEffect(() => {
    if (!seed.id) return;
    let vivo = true;
    void getTaskDetail(seed.id).then((res) => {
      if (!vivo || "error" in res) return;
      setComments(res.comments);
      setEvents(res.events);
      setAttachments(res.attachments);
    });
    return () => { vivo = false; };
  }, [seed.id]);

  const recarregarDetalhe = () => {
    if (!seed.id) return;
    void getTaskDetail(seed.id).then((res) => {
      if ("error" in res) return;
      setComments(res.comments); setEvents(res.events); setAttachments(res.attachments);
    });
  };

  const rodar = (fn: () => Promise<{ error?: string }>, depois?: () => void) => {
    iniciar(async () => {
      const res = await fn();
      if (res?.error) { toast.error(res.error); return; }
      depois?.();
      router.refresh();
    });
  };

  function salvar() {
    setErro("");
    iniciar(async () => {
      const input: TaskInput = {
        title: draft.title,
        description: draft.description,
        start_date: draft.startDate || null,
        due_date: draft.dueDate || null,
        priority: draft.priority || null,
        recurrence: draft.recurrence,
        assigneeIds: draft.assigneeIds,
      };
      const res = seed.id ? await updateTask(seed.id, input) : await createTask(draft.bucketId, input);
      if (res?.error) { setErro(res.error); return; }
      // etiquetas fazem parte do salvar só na EDIÇÃO (na criação o cartão ainda
      // não existia quando a pessoa escolheu; o fluxo de criação não mostra)
      if (seed.id) {
        const eL = await setTaskLabels(seed.id, draft.labelIds);
        if (eL?.error) { setErro(eL.error); return; }
      }
      onClose();
      router.refresh();
    });
  }

  async function excluir() {
    if (!seed.id) return;
    const ok = await confirmDialog({
      title: "Excluir tarefa",
      message: `Excluir "${draft.title}"? Checklist, comentários e anexos vão junto.`,
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (!ok) return;
    onClose();
    rodar(() => deleteTask(seed.id!));
  }

  function criarEtiqueta() {
    if (!novaEtiqueta || !seed.id) return;
    const { nome, cor } = novaEtiqueta;
    iniciar(async () => {
      const res = await createLabel(boardId, nome, cor);
      if (res?.error) { toast.error(res.error); return; }
      if (res.labelId) {
        setLabels((ls) => [...ls, { id: res.labelId!, name: nome.trim(), color: cor }]);
        setDraft((d) => ({ ...d, labelIds: [...d.labelIds, res.labelId!] }));
      }
      setNovaEtiqueta(null);
      router.refresh();
    });
  }

  async function apagarEtiqueta(label: BoardLabel) {
    const ok = await confirmDialog({
      title: "Excluir etiqueta",
      message: `Excluir "${label.name}" do quadro? Ela some de todos os cartões.`,
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (!ok) return;
    setLabels((ls) => ls.filter((l) => l.id !== label.id));
    setDraft((d) => ({ ...d, labelIds: d.labelIds.filter((id) => id !== label.id) }));
    rodar(() => deleteLabel(label.id));
  }

  function enviarArquivos(files: FileList | null) {
    if (!files?.length || !seed.id) return;
    const fd = new FormData();
    fd.set("task_id", seed.id);
    for (const f of files) fd.append("files", f);
    rodar(() => uploadTaskAttachment(fd), recarregarDetalhe);
  }

  async function baixarAnexo(id: string) {
    const url = await getTaskAttachmentUrl(id);
    if (url) window.open(url, "_blank");
    else toast.error("Não foi possível abrir o anexo.");
  }

  const feitos = itens.filter((i) => i.done).length;

  function abrirMover() {
    iniciar(async () => {
      const res = await getMoveTargets();
      if ("error" in res) { toast.error(res.error); return; }
      const outros = res.boards.filter((b) => b.id !== boardId && b.buckets.length > 0);
      if (!outros.length) { toast.error("Não há outro quadro seu para receber a tarefa."); return; }
      setMover({ boards: outros, boardId: outros[0].id, bucketId: outros[0].buckets[0].id });
    });
  }

  function confirmarMover() {
    if (!mover || !seed.id) return;
    iniciar(async () => {
      const res = await moveTaskToBoard(seed.id!, mover.boardId, mover.bucketId);
      if (res?.error) { toast.error(res.error); return; }
      toast.success("Tarefa movida. As etiquetas ficaram no quadro de origem.");
      onClose();
      router.refresh();
    });
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3,6,14,0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 640, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>{editando ? "Tarefa" : "Nova tarefa"}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1.1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          {/* ------------------------------------------------ campos principais */}
          <div>
            <label className="label">Título</label>
            <input className="input" autoFocus={!editando} value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="O que precisa ser feito?" />
          </div>
          <div>
            <label className="label">Descrição</label>
            <textarea className="input" rows={2} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.7rem" }}>
            <div>
              <label className="label">Início</label>
              <input type="date" className="input" value={draft.startDate} onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))} />
            </div>
            <div>
              <label className="label">Prazo</label>
              <input type="date" className="input" value={draft.dueDate} onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))} />
            </div>
            <div>
              <label className="label">Repetir</label>
              <select className="select" value={draft.recurrence} onChange={(e) => setDraft((d) => ({ ...d, recurrence: e.target.value as Enums<"planner_recurrence"> }))}>
                {(Object.keys(RECURRENCE_LABEL) as Enums<"planner_recurrence">[]).map((r) => (
                  <option key={r} value={r}>{RECURRENCE_LABEL[r]}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.7rem" }}>
            <div>
              <label className="label">Prioridade</label>
              <select className="select" value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as Enums<"priority_level"> | "" }))}>
                <option value="">Sem prioridade</option>
                {(Object.keys(PRIORITY) as Enums<"priority_level">[]).map((p) => <option key={p} value={p}>{PRIORITY[p]}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Progresso</label>
              {/* progresso grava NA HORA na edição: é o campo que as outras
                  pessoas do quadro estão esperando ver mudar */}
              <select
                className="select"
                value={draft.progress}
                onChange={(e) => {
                  const p = e.target.value as Enums<"planner_progress">;
                  setDraft((d) => ({ ...d, progress: p }));
                  if (seed.id) rodar(() => setTaskProgress(seed.id!, p));
                }}
              >
                {(Object.keys(PROGRESS_LABEL) as Enums<"planner_progress">[]).map((p) => (
                  <option key={p} value={p}>{PROGRESS_LABEL[p]}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Responsáveis</label>
            <PeoplePicker people={participantes} selected={draft.assigneeIds} onChange={(ids) => setDraft((d) => ({ ...d, assigneeIds: ids }))} placeholder="Participantes do quadro…" />
          </div>

          {/* ------------------------------------------------------ etiquetas */}
          {editando && (
            <div>
              <label className="label">Etiquetas</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
                {labels.map((l) => {
                  const ativa = draft.labelIds.includes(l.id);
                  return (
                    <span key={l.id} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                      <button
                        type="button"
                        onClick={() => setDraft((d) => ({ ...d, labelIds: ativa ? d.labelIds.filter((id) => id !== l.id) : [...d.labelIds, l.id] }))}
                        title={ativa ? "Remover do cartão" : "Aplicar ao cartão"}
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", opacity: ativa ? 1 : 0.45 }}
                      >
                        <Badge tone={l.color as Tone}>{l.name}</Badge>
                      </button>
                      <button type="button" className="icon-btn" title="Excluir etiqueta do quadro" style={{ padding: 1 }} onClick={() => void apagarEtiqueta(l)}>
                        <X size={11} />
                      </button>
                    </span>
                  );
                })}
                {novaEtiqueta ? (
                  <span style={{ display: "inline-flex", gap: "0.3rem", alignItems: "center" }}>
                    <input className="input" style={{ width: 140, padding: "0.25rem 0.5rem", fontSize: "0.8rem" }} autoFocus placeholder="Nome"
                      value={novaEtiqueta.nome} onChange={(e) => setNovaEtiqueta((n) => (n ? { ...n, nome: e.target.value } : n))}
                      onKeyDown={(e) => { if (e.key === "Enter" && novaEtiqueta.nome.trim()) criarEtiqueta(); }} />
                    <select className="select" style={{ width: 110, padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                      value={novaEtiqueta.cor} onChange={(e) => setNovaEtiqueta((n) => (n ? { ...n, cor: e.target.value } : n))}>
                      {CORES.map((c) => <option key={c.key} value={c.key}>{c.nome}</option>)}
                    </select>
                    <button type="button" className="btn btn-primary btn-xs" disabled={!novaEtiqueta.nome.trim() || pendente} onClick={criarEtiqueta}>Criar</button>
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => setNovaEtiqueta(null)}>×</button>
                  </span>
                ) : (
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setNovaEtiqueta({ nome: "", cor: "blue" })}>
                    <Plus size={12} /> Etiqueta
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ------------------------------------------------------ checklist */}
          {editando && (
            <div>
              <label className="label">Checklist{itens.length > 0 && <span className="soft"> · {feitos}/{itens.length}</span>}</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                {itens.map((i) => (
                  <div key={i.id} style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                    <input
                      type="checkbox"
                      checked={i.done}
                      onChange={(e) => {
                        const done = e.target.checked;
                        setItens((xs) => xs.map((x) => (x.id === i.id ? { ...x, done } : x)));
                        rodar(() => toggleChecklistItem(i.id, done));
                      }}
                    />
                    <span style={{ fontSize: "0.86rem", flex: 1, textDecoration: i.done ? "line-through" : undefined, color: i.done ? "var(--text-muted)" : undefined }}>{i.title}</span>
                    <button type="button" className="icon-btn" title="Remover item" style={{ padding: 2 }}
                      onClick={() => { setItens((xs) => xs.filter((x) => x.id !== i.id)); rodar(() => deleteChecklistItem(i.id)); }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <input className="input" style={{ flex: 1, padding: "0.35rem 0.6rem", fontSize: "0.85rem" }} placeholder="Adicionar item…"
                    value={novoItem} onChange={(e) => setNovoItem(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && novoItem.trim() && seed.id) {
                        const texto = novoItem.trim();
                        setNovoItem("");
                        rodar(() => addChecklistItem(seed.id!, texto));
                      }
                    }} />
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!novoItem.trim() || pendente}
                    onClick={() => { if (!seed.id) return; const texto = novoItem.trim(); setNovoItem(""); rodar(() => addChecklistItem(seed.id!, texto)); }}>
                    Adicionar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* --------------------------------------------------------- anexos */}
          {editando && (
            <div>
              <label className="label">Anexos</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                {attachments.map((a) => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.85rem" }}>
                    <Paperclip size={13} className="soft" />
                    <button type="button" className="cell-link" style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => void baixarAnexo(a.id)}>
                      {a.fileName}
                    </button>
                    {a.sizeBytes != null && <span className="soft" style={{ fontSize: "0.74rem" }}>{Math.max(1, Math.round(a.sizeBytes / 1024))} KB</span>}
                    <button type="button" className="icon-btn" title="Remover anexo" style={{ padding: 2 }}
                      onClick={() => { setAttachments((xs) => xs.filter((x) => x.id !== a.id)); rodar(() => deleteTaskAttachment(a.id), recarregarDetalhe); }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <div>
                  <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { enviarArquivos(e.target.files); e.target.value = ""; }} />
                  <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={() => fileRef.current?.click()}>
                    <Paperclip size={13} /> Anexar arquivo
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ---------------------------------------------------- comentários */}
          {editando && (
            <div>
              <label className="label">Comentários</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {comments.map((c) => (
                  <div key={c.id} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                    <Avatar name={c.authorName} userId={c.authorId} size={22} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.78rem" }}>
                        <strong>{c.authorName}</strong>{" "}
                        <span className="soft">{formatDateTime(c.createdAt)}</span>
                      </div>
                      <div style={{ fontSize: "0.86rem", whiteSpace: "pre-wrap" }}>{c.body}</div>
                    </div>
                    {c.authorId === currentUserId && (
                      <button type="button" className="icon-btn" title="Apagar comentário" style={{ padding: 2 }}
                        onClick={() => { setComments((xs) => xs.filter((x) => x.id !== c.id)); rodar(() => deleteTaskComment(c.id), recarregarDetalhe); }}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <textarea className="input" rows={1} style={{ flex: 1, padding: "0.4rem 0.6rem", fontSize: "0.86rem" }} placeholder="Escreva um comentário…"
                    value={novoComentario} onChange={(e) => setNovoComentario(e.target.value)} />
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!novoComentario.trim() || pendente}
                    onClick={() => { if (!seed.id) return; const texto = novoComentario.trim(); setNovoComentario(""); rodar(() => addTaskComment(seed.id!, texto), recarregarDetalhe); }}>
                    Enviar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------ mover de quadro */}
          {editando && (
            <div>
              {mover ? (
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
                  <select className="select" style={{ width: 190, padding: "0.3rem 0.55rem", fontSize: "0.83rem" }} value={mover.boardId}
                    onChange={(e) => {
                      const b = mover.boards.find((x) => x.id === e.target.value);
                      if (b) setMover({ ...mover, boardId: b.id, bucketId: b.buckets[0].id });
                    }}>
                    {mover.boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <select className="select" style={{ width: 160, padding: "0.3rem 0.55rem", fontSize: "0.83rem" }} value={mover.bucketId}
                    onChange={(e) => setMover({ ...mover, bucketId: e.target.value })}>
                    {(mover.boards.find((b) => b.id === mover.boardId)?.buckets ?? []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                  </select>
                  <button type="button" className="btn btn-primary btn-xs" disabled={pendente} onClick={confirmarMover}>Mover</button>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMover(null)}>Cancelar</button>
                </div>
              ) : (
                <button type="button" className="btn btn-ghost btn-xs" disabled={pendente} onClick={abrirMover}>
                  Mover para outro quadro
                </button>
              )}
            </div>
          )}

          {/* ------------------------------------------------------ histórico */}
          {editando && (
            <div>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setHistoricoAberto((v) => !v)} aria-expanded={historicoAberto}>
                {historicoAberto ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Histórico ({events.length}{events.length === 30 ? "+" : ""})
              </button>
              {historicoAberto && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginTop: "0.4rem", maxHeight: 220, overflowY: "auto" }}>
                  {events.map((ev) => (
                    <div key={ev.id} className="muted" style={{ fontSize: "0.78rem" }}>
                      <strong>{ev.actorName}</strong> {EVENTO_LABEL[ev.type] ?? ev.type}
                      {typeof ev.meta.para === "string" && ev.type === "due_changed" && <> para {formatDate(ev.meta.para)}</>}
                      {typeof ev.meta.para === "string" && ev.type === "progress_changed" && (
                        <> · <Badge tone={PROGRESS_TONE[ev.meta.para as Enums<"planner_progress">] ?? "gray"}>{PROGRESS_LABEL[ev.meta.para as Enums<"planner_progress">] ?? String(ev.meta.para)}</Badge></>
                      )}
                      <span className="soft"> · {formatDateTime(ev.createdAt)}</span>
                    </div>
                  ))}
                  {events.length === 0 && <span className="soft" style={{ fontSize: "0.8rem" }}>Sem eventos ainda.</span>}
                </div>
              )}
            </div>
          )}

          {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "0.9rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          {editando && (
            <button type="button" className="btn btn-ghost" style={{ marginRight: "auto", color: "var(--mh-danger)" }} onClick={() => void excluir()}>
              Excluir
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={pendente || !draft.title.trim()} onClick={salvar}>
            {pendente ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
