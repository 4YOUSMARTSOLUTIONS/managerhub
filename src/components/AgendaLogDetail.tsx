"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge";
import { AGENDA_STATUS_LABEL, AGENDA_STATUS_TONE } from "@/lib/constants";
import { formatDateTime, shortName } from "@/lib/format";
import type { Enums } from "@/types/database";
import {
  openLog, setLogStatus, addLogComment, uploadLogAttachments, deleteLogAttachment,
  getLogThread, getAgendaAttachmentUrl, type LogThread,
} from "@/lib/actions/agenda";

/** Ordem de leitura, do melhor para o pior. `pendente` é o "ainda não". */
const STATUS_OPCOES: Enums<"agenda_log_status">[] = ["feito", "parcial", "nao_feito", "pendente"];

/** As mesmas cores do interruptor da lista: verde, âmbar, vermelho.
 *  `pendente` não tem cor porque é a ausência de decisão, e não um resultado. */
const STATUS_COR: Record<Enums<"agenda_log_status">, string | null> = {
  feito: "var(--mh-success)",
  parcial: "var(--mh-warning)",
  nao_feito: "var(--mh-danger)",
  pendente: null,
};

export type LogDetailCtx = {
  agendaId: string;
  taskId: string;
  logDate: string;
  title: string;
  agendaName: string;
  status: Enums<"agenda_log_status">;
  note: string | null;
  logId: string | null;
};

export function AgendaLogDetail({
  ctx, onClose, canFill, nameById,
}: {
  ctx: LogDetailCtx | null;
  onClose: () => void;
  canFill: boolean;
  nameById: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [logId, setLogId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  /**
   * Status vive aqui e não em `ctx`, que é um retrato tirado no clique.
   *
   * A lista virou um liga/desliga (fiz / não fiz ainda), e os dois meio-termos
   * moraram aqui: quem marca "parcial" ou "não realizada" quase sempre precisa
   * escrever por quê, e a justificativa está logo abaixo.
   */
  const [status, setStatus] = useState<Enums<"agenda_log_status">>("pendente");
  const [thread, setThread] = useState<LogThread>({ comments: [], attachments: [] });
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!ctx) return;
    setNote(ctx.note ?? "");
    setStatus(ctx.status);
    setComment("");
    setLoading(true);
    (async () => {
      let id = ctx.logId;
      if (!id) {
        const r = await openLog({ agenda_id: ctx.agendaId, task_id: ctx.taskId, log_date: ctx.logDate });
        id = r.logId ?? null;
      }
      setLogId(id);
      if (id) setThread(await getLogThread(id));
      setLoading(false);
    })();
  }, [ctx]);

  if (!ctx) return null;

  const reload = async () => { if (logId) setThread(await getLogThread(logId)); };

  const mudarStatus = (novo: Enums<"agenda_log_status">) => start(async () => {
    const r = await setLogStatus({ agenda_id: ctx.agendaId, task_id: ctx.taskId, log_date: ctx.logDate, status: novo, note });
    if (r.error) { toast.error(r.error); return; }
    if (r.logId) setLogId(r.logId);
    setStatus(novo);
    router.refresh();
  });

  const saveNote = () => start(async () => {
    const r = await setLogStatus({ agenda_id: ctx.agendaId, task_id: ctx.taskId, log_date: ctx.logDate, status, note });
    if (r.error) { toast.error(r.error); return; }
    if (r.logId) setLogId(r.logId);
    toast.success("Observação salva.");
    router.refresh();
  });

  const send = () => start(async () => {
    if (!logId || !comment.trim()) return;
    const r = await addLogComment({ log_id: logId, body: comment });
    if (r.error) { toast.error(r.error); return; }
    setComment("");
    await reload();
  });

  const onFiles = (files: FileList | null) => {
    if (!files || !files.length || !logId) return;
    const fd = new FormData();
    fd.append("log_id", logId);
    Array.from(files).forEach((f) => fd.append("files", f));
    start(async () => {
      const r = await uploadLogAttachments(fd);
      if (r.error) { toast.error(r.error); return; }
      await reload();
    });
  };

  const removeAtt = (id: string) => start(async () => {
    const r = await deleteLogAttachment(id);
    if (r.error) { toast.error(r.error); return; }
    await reload();
  });

  const openAtt = async (path: string) => {
    const url = await getAgendaAttachmentUrl(path);
    if (url) window.open(url, "_blank"); else toast.error("Não foi possível abrir o anexo.");
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3,6,14,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 55, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 560, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem", borderBottom: "1px solid var(--mh-border)", gap: "0.75rem" }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>{ctx.title}</h2>
            <div className="soft" style={{ fontSize: "0.78rem", marginTop: 2 }}>{ctx.agendaName}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <Badge tone={AGENDA_STATUS_TONE[status]}>{AGENDA_STATUS_LABEL[status]}</Badge>
            <button type="button" onClick={onClose} className="icon-btn" aria-label="Fechar"><X size={16} /></button>
          </div>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          {canFill && (
            <div>
              <label className="label">Status</label>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                {STATUS_OPCOES.map((s) => {
                  const escolhido = status === s;
                  const cor = STATUS_COR[s];
                  return (
                    <button
                      key={s}
                      type="button"
                      className={`btn btn-sm ${escolhido ? "" : "btn-ghost"}`}
                      disabled={pending}
                      aria-pressed={escolhido}
                      onClick={() => mudarStatus(s)}
                      // Só o escolhido ganha cor. Pintar os quatro de uma vez
                      // encheria o painel de semáforo e a opção marcada deixaria
                      // de saltar, que é a única coisa que precisa saltar aqui.
                      style={
                        !escolhido
                          ? undefined
                          : cor
                            ? { background: cor, color: "#fff", borderColor: cor }
                            : { background: "var(--mh-surface-2)", color: "var(--mh-text-1)", borderColor: "var(--mh-border-strong)" }
                      }
                    >
                      {AGENDA_STATUS_LABEL[s]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="label">Observação / justificativa</label>
            <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} disabled={!canFill} placeholder="Ex.: não realizada por indisponibilidade do sistema…" />
            {canFill && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.5rem" }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={saveNote} disabled={pending}>Salvar observação</button>
              </div>
            )}
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <label className="label" style={{ margin: 0 }}>Anexos</label>
              {canFill && (
                <>
                  <input ref={fileRef} type="file" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={pending || !logId}>
                    <Paperclip size={14} /> Anexar
                  </button>
                </>
              )}
            </div>
            {thread.attachments.length === 0 ? (
              <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>Nenhum anexo.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {thread.attachments.map((a) => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.82rem" }}>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: "flex-start", overflow: "hidden", textOverflow: "ellipsis" }} onClick={() => openAtt(a.path)}>
                      <Paperclip size={13} /> {a.filename}
                    </button>
                    {canFill && <button type="button" className="icon-btn icon-btn-danger" title="Remover" onClick={() => removeAtt(a.id)}><Trash2 size={14} /></button>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="label">Comentários</label>
            {loading ? (
              <p className="soft" style={{ fontSize: "0.8rem" }}>Carregando…</p>
            ) : thread.comments.length === 0 ? (
              <p className="soft" style={{ fontSize: "0.8rem", margin: "0 0 0.5rem" }}>Nenhum comentário ainda.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "0.6rem" }}>
                {thread.comments.map((c) => (
                  <div key={c.id} style={{ background: "var(--mh-surface-2)", borderRadius: "var(--mh-radius-sm)", padding: "0.5rem 0.7rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", fontSize: "0.72rem" }} className="soft">
                      <strong style={{ color: "var(--mh-text-2)" }}>{shortName(nameById[c.authorId] ?? "Usuário")}</strong>
                      <span>{formatDateTime(c.createdAt)}</span>
                    </div>
                    <div style={{ fontSize: "0.85rem", marginTop: 2, whiteSpace: "pre-wrap" }}>{c.body}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Escreva um comentário…" onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
              <button type="button" className="btn btn-primary btn-sm" onClick={send} disabled={pending || !comment.trim() || !logId}>Enviar</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
